#!/usr/bin/env node
/**
 * Ретранслятор оповещений мониторинга: Uptime Kuma → бот Discord → личные
 * сообщения владельцам (#305).
 *
 * Вебхуки Discord пишут только в каналы, поэтому Kuma присылает вебхук сюда,
 * а этот сервис отправляет личное сообщение от имени бота сайта. Он живёт
 * в проекте мониторинга, а не в API сайта, намеренно: оповещение «API не
 * отвечает» не должно зависеть от самого API.
 *
 * Зависимостей нет (Node.js 22+). Переменные окружения:
 *   ALERT_RELAY_TOKEN        общий с Kuma секрет (Authorization: Bearer …)
 *   ALERT_BOT_TOKEN          токен бота Discord
 *   ALERT_DISCORD_USER_IDS   получатели через запятую; бот должен видеть
 *                            каждого на общем сервере
 *   PORT                     порт HTTP, по умолчанию 8080
 *   DISCORD_API_BASE         адрес API Discord (подменяется в проверках)
 *
 *   POST /alert  — вебхук Kuma: { heartbeat, monitor, msg }; 200, если сообщение
 *                  доставлено всем получателям, иначе 502
 *   GET /healthz — проверка живости
 *
 * В журнал попадают только монитор, состояние и итог — без секретов.
 */

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 256 * 1024;
// Попыток после первой; паузы между ними растут, при 429 ждём столько, сколько просит Discord.
const RETRIES = 3;
const BACKOFF_MS = [1000, 4000, 10_000];
// Discord ограничивает личку пятью сообщениями в 5 секунд: одновременная авария
// трёх мониторов не должна упереться в лимит.
const ALERT_GAP_MS = 1200;
const MOSCOW_TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Discord отказала окончательно: повторять бессмысленно. */
class DeliveryError extends Error {}
class BodyTooLargeError extends Error {}

/**
 * Читает и проверяет переменные окружения ретранслятора.
 * @param {Record<string, string | undefined>} env
 * @returns {object}
 */
export function readConfig(env) {
  const value = (name) => (env[name] ?? '').trim();
  const config = {
    token: value('ALERT_RELAY_TOKEN'),
    botToken: value('ALERT_BOT_TOKEN'),
    userIds: value('ALERT_DISCORD_USER_IDS')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    port: Number(value('PORT') || 8080),
    apiBase: value('DISCORD_API_BASE') || 'https://discord.com/api/v10',
  };
  const problems = [];
  if (config.token.length < 16) {
    problems.push('ALERT_RELAY_TOKEN: нужен секрет не короче 16 символов');
  }
  if (!config.botToken) problems.push('ALERT_BOT_TOKEN: нужен токен бота Discord');
  if (config.userIds.length === 0) {
    problems.push('ALERT_DISCORD_USER_IDS: укажите ID получателей через запятую');
  }
  if (config.userIds.some((id) => !/^\d{17,20}$/.test(id))) {
    problems.push('ALERT_DISCORD_USER_IDS: ID пользователя Discord — это 17–20 цифр');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    problems.push('PORT: ожидается номер порта');
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
  return config;
}

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Момент проверки Kuma — UTC строкой без зоны («2026-11-26 12:00:00.123»). */
function kumaTime(value) {
  const date = new Date(`${String(value).trim().replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** @param {number} ms @returns {string} например «12 минут» или «1 час 5 минут» */
export function formatDowntime(ms) {
  let minutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  minutes %= 1440;
  const hours = Math.floor(minutes / 60);
  minutes %= 60;
  const parts = [];
  if (days > 0) parts.push(`${days} ${plural(days, 'день', 'дня', 'дней')}`);
  if (hours > 0) parts.push(`${hours} ${plural(hours, 'час', 'часа', 'часов')}`);
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}`);
  }
  return parts.join(' ');
}

/** @param {unknown} value @returns {string} время проверки по Москве или пустая строка */
export function moscowTime(value) {
  const date = kumaTime(value);
  return date ? MOSCOW_TIME.format(date).replace(', ', ' ') : '';
}

// Kuma пишет «[монитор] [🔴 Down] причина» — имя и значок в сообщении свои.
const KUMA_PREFIX = /^\[[^\]]*\]\s*\[[^\]]*\]\s*/;
// «[монитор][адрес] leaf certificate suneclipse.ru will expire in 14 days»
const CERTIFICATE = /^\[([^\]]*)\]\[[^\]]*\] .*certificate (.+?) will expire in (\d+) days/;

/**
 * Текст личного сообщения по вебхуку Kuma.
 * @param {any} payload
 * @returns {string}
 */
export function formatAlert(payload) {
  const msg = typeof payload?.msg === 'string' ? payload.msg.trim() : '';
  const heartbeat = payload?.heartbeat;
  const name = typeof payload?.monitor?.name === 'string' ? payload.monitor.name : '';
  if (heartbeat && typeof heartbeat === 'object') {
    const status = Number(heartbeat.status);
    const reason = msg.replace(KUMA_PREFIX, '').trim();
    if (status === 0) {
      const when = moscowTime(heartbeat.time);
      return ['🔴 Авария: ' + name, reason, when ? `с ${when} МСК` : ''].filter(Boolean).join('\n');
    }
    if (status === 1) {
      const start = kumaTime(heartbeat.lastDownTime);
      const end = kumaTime(heartbeat.time);
      const downtime =
        start && end && end > start ? `недоступен ${formatDowntime(end - start)}` : '';
      return ['🟢 Восстановление: ' + name, downtime].filter(Boolean).join('\n');
    }
    if (status === 3) return `🟡 Техническое обслуживание: ${name}`;
    return `ℹ️ ${name}: ${reason}`.trim();
  }
  // Без состояния приходят только проверка канала и срок сертификата.
  const certificate = CERTIFICATE.exec(msg);
  if (certificate) {
    const [, monitor, commonName, daysText] = certificate;
    const days = Number(daysText);
    return [
      `⚠️ Срок сертификата: ${commonName} истекает через ${days} ${plural(days, 'день', 'дня', 'дней')}`,
      `Проверка «${monitor}»`,
    ].join('\n');
  }
  if (/testing$/i.test(msg)) {
    return '✅ Проверка оповещений: бот доставил это сообщение в личку. Аварии сайта будут приходить сюда.';
  }
  return `ℹ️ ${msg}`;
}

/**
 * Один запрос к Discord.
 * @returns {Promise<{ok?: boolean, data?: any, retryable: boolean, status: number, retryAfterMs?: number}>}
 */
async function discordPost(config, path, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${config.apiBase}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${config.botToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Сеть или таймаут — повторяем.
    return { retryable: true, status: 0 };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.ok) return { ok: true, data };
  return {
    retryable: response.status === 429 || response.status >= 500,
    status: response.status,
    retryAfterMs: typeof data?.retry_after === 'number' ? data.retry_after * 1000 : undefined,
  };
}

/**
 * Повторяет запрос к Discord на сетевые ошибки, 429 и 5xx.
 * @param {string} what что не удалось — для сообщения об окончательном отказе
 * @param {() => Promise<object>} attempt один запрос
 * @returns {Promise<any>} данные успешного ответа
 * @throws {DeliveryError} Discord отказала окончательно или недоступна слишком долго
 */
async function withRetries(what, attempt, { pause }) {
  let last = { status: 0, retryAfterMs: undefined };
  for (let tries = 1; ; tries += 1) {
    const result = await attempt();
    if (result.ok) return result.data;
    if (!result.retryable) throw new DeliveryError(`${what} (HTTP ${result.status})`);
    last = result;
    if (tries > RETRIES) {
      throw new DeliveryError(`Discord недоступна после ${tries} попыток (HTTP ${last.status})`);
    }
    await pause(Math.max(BACKOFF_MS[tries - 1], last.retryAfterMs ?? 0));
  }
}

/**
 * Личное сообщение одному получателю. Личка открывается один раз: повторяется
 * только отправка — у открытия канала свой лимит частоты.
 * @throws {DeliveryError} Discord отказала окончательно или недоступна слишком долго
 */
async function sendDirectMessage(config, userId, content, { fetchImpl, pause }) {
  const io = { fetchImpl, pause };
  const channel = await withRetries(
    'Discord не открыла личку',
    () => discordPost(config, '/users/@me/channels', { recipient_id: userId }, fetchImpl),
    io,
  );
  await withRetries(
    'Discord отклонила сообщение',
    () =>
      discordPost(
        config,
        `/channels/${channel.id}/messages`,
        { content, allowed_mentions: { parse: [] } },
        fetchImpl,
      ),
    io,
  );
}

/**
 * Читает тело запроса, не превышая лимит. Лишние байты не копятся, но и не
 * обрывают соединение — клиент должен получить ответ 413, а не разрыв.
 */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

/** Сверка секрета постоянным временем; длины сравниваются до timingSafeEqual. */
function sameSecret(given, expected) {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * HTTP-сервер ретранслятора.
 * @param {object} config
 * @param {{ fetchImpl?: Function, log?: (line: string) => void, pause?: (ms: number) => Promise<void> }} [options]
 * @returns {import('node:http').Server}
 */
export function createRelay(config, { fetchImpl = fetch, log = console.log, pause = sleep } = {}) {
  let queue = Promise.resolve();
  // Оповещения уходят по одному с паузой — см. ALERT_GAP_MS.
  const enqueue = (task) => {
    const run = queue.then(task, task);
    queue = run.then(
      () => pause(ALERT_GAP_MS),
      () => pause(ALERT_GAP_MS),
    );
    return run;
  };
  const stamp = () => new Date().toISOString();

  return createServer(async (request, response) => {
    const reply = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload));
    };
    try {
      const { pathname } = new URL(request.url ?? '/', 'http://relay');
      if (request.method === 'GET' && pathname === '/healthz') return reply(200, { ok: true });
      if (request.method !== 'POST' || pathname !== '/alert') return reply(404, { ok: false });
      const header = request.headers.authorization ?? '';
      if (!header.startsWith('Bearer ') || !sameSecret(header.slice(7), config.token)) {
        return reply(401, { ok: false });
      }
      const payload = JSON.parse(await readBody(request, MAX_BODY_BYTES));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return reply(400, { ok: false });
      }
      const content = formatAlert(payload);
      const title = payload.monitor?.name ?? 'проверка канала';
      const delivered = await enqueue(async () => {
        let sent = 0;
        let failure = '';
        for (const userId of config.userIds) {
          try {
            await sendDirectMessage(config, userId, content, { fetchImpl, pause });
            sent += 1;
          } catch (error) {
            failure = error instanceof DeliveryError ? error.message : 'внутренняя ошибка';
          }
        }
        log(
          `${stamp()} «${title}» → доставлено ${sent} из ${config.userIds.length}${failure ? ` (${failure})` : ''}`,
        );
        return sent === config.userIds.length;
      });
      return reply(delivered ? 200 : 502, { ok: delivered });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return reply(413, { ok: false });
      log(
        `${stamp()} запрос отклонён: ${error instanceof SyntaxError ? 'невалидный JSON' : 'ошибка чтения'}`,
      );
      return reply(400, { ok: false });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readConfig(process.env);
    const server = createRelay(config);
    server.listen(config.port, () => {
      console.log(
        `Ретранслятор оповещений слушает порт ${config.port}, получателей: ${config.userIds.length}`,
      );
    });
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, () => server.close(() => process.exit(0)));
    }
  } catch (error) {
    console.error(`ОШИБКА: ${error.message}`);
    process.exitCode = 1;
  }
}
