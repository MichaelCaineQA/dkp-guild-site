#!/usr/bin/env node
/**
 * Внешний пробник доступности сайта (PLAN.md §8 и этап 7, #305): проверка
 * `/api/health` с зондов Globalping в РФ и Латвии.
 *
 * Мониторинг на самом VPS не заметит отказа сервера или блокировки адреса
 * на пути от пользователей, поэтому пробник запускается извне — workflow
 * `Uptime probe` в GitHub Actions. Авария — это неудача запуска workflow:
 * GitHub присылает письмо о неудавшемся запланированном запуске.
 *
 * Зависимостей нет (Node.js 22+). Переменные окружения:
 *   PROBE_TARGET         имя хоста сайта, по умолчанию suneclipse.ru
 *   PROBE_COUNTRIES      страны зондов через запятую, по умолчанию RU,LV
 *   PROBE_ATTEMPTS       попыток всего, по умолчанию 3
 *   PROBE_ATTEMPT_DELAY  пауза между попытками, мс, по умолчанию 20000
 *   GLOBALPING_API       адрес API Globalping (подменяется в проверках)
 *
 * Код выхода: 0 — все зонды видят здоровый сайт, 1 — авария или проверить
 * не удалось, 2 — неверные настройки. Чтобы не тревожить из-за разового сбоя
 * зонда, аварией считается только неудача всех попыток подряд.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const USER_AGENT =
  'dkp-guild-site-uptime-probe/1.0 (+https://github.com/MichaelCaineQA/dkp-guild-site)';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const POLL_LIMIT = 30;

/**
 * Читает и проверяет переменные окружения пробника.
 * @param {Record<string, string | undefined>} env
 * @returns {object}
 */
export function readConfig(env) {
  const value = (name) => (env[name] ?? '').trim();
  const config = {
    target: value('PROBE_TARGET') || 'suneclipse.ru',
    countries: (value('PROBE_COUNTRIES') || 'RU,LV')
      .split(',')
      .map((country) => country.trim().toUpperCase())
      .filter(Boolean),
    attempts: Number(value('PROBE_ATTEMPTS') || 3),
    attemptDelayMs: Number(value('PROBE_ATTEMPT_DELAY') || 20_000),
    api: value('GLOBALPING_API') || 'https://api.globalping.io/v1',
  };
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(config.target)) {
    throw new Error('PROBE_TARGET: ожидается имя хоста без схемы, пути и порта');
  }
  if (config.countries.length === 0 || config.countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
    throw new Error('PROBE_COUNTRIES: коды стран из двух букв через запятую');
  }
  if (!Number.isInteger(config.attempts) || config.attempts < 1 || config.attempts > 10) {
    throw new Error('PROBE_ATTEMPTS: ожидается число от 1 до 10');
  }
  if (!Number.isFinite(config.attemptDelayMs) || config.attemptDelayMs < 0) {
    throw new Error('PROBE_ATTEMPT_DELAY: ожидается число миллисекунд');
  }
  return config;
}

/**
 * Оценка одного зонда: сайт доступен, если ответ HTTP 200 и в теле status ok и db up.
 * @param {{probe?: object, result?: object}} entry
 * @returns {{country: string, city: string, network: string, ok: boolean, detail: string}}
 */
export function evaluateProbe(entry) {
  const probe = entry?.probe ?? {};
  const result = entry?.result ?? {};
  const place = {
    country: String(probe.country ?? '??'),
    city: String(probe.city ?? '?'),
    network: String(probe.network ?? '?'),
  };
  if (result.status !== 'finished') {
    const state = result.status === 'failed' ? 'ошибка' : (result.status ?? 'нет результата');
    return { ...place, ok: false, detail: `зонд не завершил проверку (${state})` };
  }
  if (result.statusCode !== 200) {
    return { ...place, ok: false, detail: `HTTP ${result.statusCode ?? 'без ответа'}` };
  }
  let body = null;
  try {
    body = JSON.parse(result.rawBody ?? '');
  } catch {
    body = null;
  }
  if (body?.status !== 'ok' || body?.db !== 'up') {
    return { ...place, ok: false, detail: 'сайт ответил, но health это не подтверждает' };
  }
  return { ...place, ok: true, detail: `${result.timings?.total ?? '?'} мс` };
}

/**
 * Сводка по измерению: каждая запрошенная страна должна быть подтверждена успешным зондом.
 * @param {object} measurement ответ Globalping
 * @param {string[]} countries
 * @returns {{ok: boolean, probes: object[], problem: string}}
 */
export function evaluateMeasurement(measurement, countries) {
  if (measurement?.status === 'failed') {
    return { ok: false, probes: [], problem: 'Globalping не смог выполнить измерение' };
  }
  const probes = (measurement?.results ?? []).map(evaluateProbe);
  const failed = probes.filter((probe) => !probe.ok);
  const missing = countries.filter(
    (country) => !probes.some((probe) => probe.country === country && probe.ok),
  );
  const problem = missing.length
    ? `нет подтверждения из ${missing.join(', ')}`
    : failed.length
      ? 'есть неудачные зонды'
      : '';
  return { ok: failed.length === 0 && missing.length === 0, probes, problem };
}

/** @param {string} text @returns {string} текст для ячейки markdown-таблицы */
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * Сводка шага для GitHub: таблица зондов последней попытки и вывод.
 * @param {object} options
 * @returns {string}
 */
export function stepSummary({ target, attempt, probes, problem, verdict }) {
  const rows = probes.length
    ? probes
        .map(
          (probe) =>
            `| ${cell(probe.country)} | ${cell(probe.city)} | ${cell(probe.network)} | ${probe.ok ? '✅ доступен' : '❌ недоступен'} | ${cell(probe.detail)} |`,
        )
        .join('\n')
    : '| — | — | — | ❌ недоступен | зондов нет |';
  return [
    `# Доступность ${target}`,
    '',
    `**${verdict}**${problem ? ` — ${problem}` : ''} (попыток: ${attempt})`,
    '',
    '| Страна | Город | Сеть | Результат | Детали |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
  ].join('\n');
}

/** Запрос к API с таймаутом; сеть и таймаут дают статус 0. */
async function call(config, path, fetchImpl, init = {}) {
  let response;
  try {
    response = await fetchImpl(`${config.api}${path}`, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        'user-agent': USER_AGENT,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...init,
    });
  } catch {
    return { status: 0, data: null };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

/** Одно измерение Globalping: создать, дождаться, оценить. */
async function measure(config, { pause, fetchImpl }) {
  const created = await call(config, '/measurements', fetchImpl, {
    method: 'POST',
    body: JSON.stringify({
      type: 'http',
      target: config.target,
      locations: config.countries.map((country) => ({ country })),
      limit: config.countries.length,
      measurementOptions: {
        protocol: 'HTTPS',
        port: 443,
        request: { method: 'GET', path: '/api/health', host: config.target },
      },
    }),
  });
  if (created.status !== 202 && created.status !== 200) {
    return {
      ok: false,
      probes: [],
      problem: `Globalping API не приняла запрос (HTTP ${created.status})`,
    };
  }
  for (let poll = 0; poll < POLL_LIMIT; poll += 1) {
    const { status, data } = await call(config, `/measurements/${created.data.id}`, fetchImpl);
    if (status !== 200) {
      return {
        ok: false,
        probes: [],
        problem: `Globalping API не отдала результат (HTTP ${status})`,
      };
    }
    if (data.status !== 'in-progress') return evaluateMeasurement(data, config.countries);
    await pause(1000);
  }
  return {
    ok: false,
    probes: [],
    problem: `Globalping не завершила измерение за ${POLL_LIMIT} секунд`,
  };
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ stdout?: any, stderr?: any, pause?: (ms: number) => Promise<void>, fetchImpl?: Function, summaryPath?: string }} [options]
 * @returns {Promise<number>} код выхода
 */
export async function main(env, options = {}) {
  const out = options.stdout ?? process.stdout;
  const err = options.stderr ?? process.stderr;
  let config;
  try {
    config = readConfig(env);
  } catch (error) {
    err.write(`ОШИБКА: ${error.message}\n`);
    return 2;
  }
  const io = { pause: options.pause ?? sleep, fetchImpl: options.fetchImpl ?? fetch };
  let last;
  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    last = await measure(config, io);
    if (last.ok) {
      for (const probe of last.probes) {
        out.write(`OK ${probe.country} (${probe.city}, ${probe.network}): ${probe.detail}\n`);
      }
      return 0;
    }
    out.write(`ПОПЫТКА ${attempt}: ${last.problem}\n`);
    for (const probe of last.probes) {
      out.write(`  ${probe.country} (${probe.city}, ${probe.network}): ${probe.detail}\n`);
    }
    if (attempt < config.attempts) await io.pause(config.attemptDelayMs);
  }
  const summaryPath = options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(
      summaryPath,
      stepSummary({
        target: config.target,
        attempt: config.attempts,
        probes: last.probes,
        problem: last.problem,
        verdict: 'Сайт недоступен или проверить не удалось',
      }),
    );
  }
  err.write(`АВАРИЯ: ${config.target} — ${last.problem} после ${config.attempts} попыток\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.env);
}
