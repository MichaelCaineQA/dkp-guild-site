// Юнит-тесты ретранслятора оповещений (node --test):
//   node --test scripts/monitoring/alert-relay.test.mjs
// Discord заменена сценарием ответов; сам ретранслятор поднимается на локальном
// порту и вызывается настоящим fetch.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRelay,
  formatAlert,
  formatDowntime,
  moscowTime,
  readConfig,
} from './alert-relay.mjs';

const TOKEN = 'relay-secret-token-0123456789';
const BOT = 'fake-bot-token';
const USERS = ['111111111111111111', '222222222222222222'];
// Адрес без пути: заглушка различает запросы по пути, как настоящие тесты ниже.
const ENV = {
  ALERT_RELAY_TOKEN: TOKEN,
  ALERT_BOT_TOKEN: BOT,
  ALERT_DISCORD_USER_IDS: USERS.join(','),
  DISCORD_API_BASE: 'https://discord.test',
};
const CHANNEL = '/users/@me/channels';
const messagePath = (user) => `/channels/dm-${user}/messages`;

const NAME = 'Прод: API — здоровье';
const DOWN = {
  msg: `[${NAME}] [🔴 Down] Request failed with status code 502`,
  heartbeat: { status: 0, time: '2026-11-26 13:20:12.000' },
  monitor: { name: NAME },
};

/**
 * Сценарий Discord: каналы и сообщения отвечают статусами по очереди
 * (последний повторяется); `throw` — сетевая ошибка.
 */
function fakeDiscord(script = {}) {
  const calls = [];
  const implementation = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ path, body, authorization: init.headers.authorization });
    const queue =
      path === '/users/@me/channels' ? (script.channels ?? []) : (script.messages ?? []);
    const status = queue.length > 1 ? queue.shift() : (queue[0] ?? 200);
    if (status === 'throw') throw new TypeError('fetch failed');
    const payload =
      status === 429
        ? { retry_after: script.retryAfter ?? 0.2 }
        : path.endsWith('/channels')
          ? { id: `dm-${body.recipient_id}` }
          : { id: 'm1' };
    return new Response(JSON.stringify(payload), { status });
  };
  return { calls, implementation };
}

async function startRelay(script, { env = ENV, config, ...options } = {}) {
  const discord = fakeDiscord(script);
  const lines = [];
  const pauses = [];
  const server = createRelay(config ?? readConfig(env), {
    fetchImpl: discord.implementation,
    log: (line) => lines.push(line),
    pause: async (ms) => {
      pauses.push(ms);
    },
    ...options,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (payload, token = TOKEN) =>
    fetch(`${base}/alert`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  return {
    base,
    post,
    discord,
    lines,
    pauses,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('readConfig: обязательные переменные и их проверка', () => {
  const config = readConfig({ ...ENV, PORT: '9090' });
  assert.equal(config.token, TOKEN);
  assert.equal(config.botToken, BOT);
  assert.deepEqual(config.userIds, USERS);
  assert.equal(config.port, 9090);
  assert.equal(config.apiBase, 'https://discord.test');
  assert.equal(readConfig({ ...ENV, DISCORD_API_BASE: '' }).apiBase, 'https://discord.com/api/v10');
  assert.throws(() => readConfig({ ...ENV, ALERT_RELAY_TOKEN: 'short' }), /ALERT_RELAY_TOKEN/);
  assert.throws(() => readConfig({ ...ENV, ALERT_BOT_TOKEN: '' }), /ALERT_BOT_TOKEN/);
  assert.throws(() => readConfig({ ...ENV, ALERT_DISCORD_USER_IDS: '' }), /ALERT_DISCORD_USER_IDS/);
  assert.throws(
    () => readConfig({ ...ENV, ALERT_DISCORD_USER_IDS: 'https://discord.com/users/1' }),
    /17–20 цифр/,
  );
  assert.throws(() => readConfig({ ...ENV, PORT: 'http' }), /PORT/);
  assert.deepEqual(
    readConfig({ ...ENV, ALERT_DISCORD_USER_IDS: ' 111111111111111111 , 222222222222222222 ,' })
      .userIds,
    USERS,
  );
});

test('formatDowntime и moscowTime: читаемый простой и время по Москве', () => {
  assert.equal(formatDowntime(5 * 60_000), '5 минут');
  assert.equal(formatDowntime(65 * 60_000), '1 час 5 минут');
  assert.equal(formatDowntime(21 * 60_000), '21 минута');
  assert.equal(formatDowntime((2 * 1440 + 1) * 60_000), '2 дня 1 минута');
  assert.equal(formatDowntime(2 * 1440 * 60_000), '2 дня');
  assert.equal(formatDowntime(30_000), '1 минута');
  assert.equal(moscowTime('2026-11-26 12:00:00.123'), '26.11.2026 15:00:00');
  assert.equal(moscowTime('not a date'), '');
});

test('formatAlert: авария, восстановление, обслуживание', () => {
  assert.equal(
    formatAlert(DOWN),
    '🔴 Авария: Прод: API — здоровье\nRequest failed with status code 502\nс 26.11.2026 16:20:12 МСК',
  );
  assert.equal(
    formatAlert({
      msg: `[${NAME}] [✅ Up] JSON query passes`,
      heartbeat: {
        status: 1,
        time: '2026-11-26 13:22:12.000',
        lastDownTime: '2026-11-26 13:20:12.000',
      },
      monitor: { name: NAME },
    }),
    '🟢 Восстановление: Прод: API — здоровье\nнедоступен 2 минуты',
  );
  assert.equal(
    formatAlert({
      msg: 'x',
      heartbeat: { status: 1, time: '2026-11-26 13:22:12.000' },
      monitor: { name: NAME },
    }),
    '🟢 Восстановление: Прод: API — здоровье',
  );
  assert.equal(
    formatAlert({ msg: 'x', heartbeat: { status: 3 }, monitor: { name: NAME } }),
    '🟡 Техническое обслуживание: Прод: API — здоровье',
  );
  // Имя и значок Kuma из текста причины убираются, пустая причина не оставляет пустой строки.
  assert.equal(
    formatAlert({ ...DOWN, msg: `[${NAME}] [🔴 Down]` }),
    '🔴 Авария: Прод: API — здоровье\nс 26.11.2026 16:20:12 МСК',
  );
});

test('formatAlert: проверка канала, срок сертификата, неизвестное событие', () => {
  const test = formatAlert({ heartbeat: null, monitor: null, msg: 'DKP: бот в личку Testing' });
  assert.ok(test.startsWith('✅ Проверка оповещений'));
  assert.equal(
    formatAlert({
      heartbeat: null,
      monitor: null,
      msg: `[${NAME}][https://suneclipse.ru/api/health] leaf certificate suneclipse.ru will expire in 14 days`,
    }),
    '⚠️ Срок сертификата: suneclipse.ru истекает через 14 дней\nПроверка «Прод: API — здоровье»',
  );
  assert.equal(
    formatAlert({
      heartbeat: null,
      monitor: null,
      msg: '[m][u] root certificate R11 will expire in 7 days',
    }),
    '⚠️ Срок сертификата: R11 истекает через 7 дней\nПроверка «m»',
  );
  assert.equal(
    formatAlert({ heartbeat: null, monitor: null, msg: 'something else' }),
    'ℹ️ something else',
  );
  assert.equal(formatAlert({}), 'ℹ️ ');
});

test('ретранслятор: здоровье, доступ только с секретом, только /alert', async () => {
  const relay = await startRelay({});
  try {
    assert.equal((await fetch(`${relay.base}/healthz`)).status, 200);
    assert.equal((await fetch(`${relay.base}/alert`)).status, 404);
    const noToken = await fetch(`${relay.base}/alert`, { method: 'POST', body: '{}' });
    assert.equal(noToken.status, 401);
    assert.equal((await relay.post(DOWN, 'wrong-secret-token-0000000')).status, 401);
    assert.equal((await relay.post('{not json')).status, 400);
    assert.equal((await relay.post('[]')).status, 400);
    assert.equal((await relay.post(JSON.stringify({ msg: 'x'.repeat(300_000) }))).status, 413);
    assert.equal(relay.discord.calls.length, 0);
  } finally {
    await relay.stop();
  }
});

test('ретранслятор: авария уходит в личку каждому получателю от имени бота', async () => {
  const relay = await startRelay({});
  try {
    const response = await relay.post(DOWN);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const messages = relay.discord.calls.filter((call) => call.path.endsWith('/messages'));
    assert.equal(messages.length, USERS.length);
    assert.deepEqual(
      relay.discord.calls
        .filter((call) => call.path === '/users/@me/channels')
        .map((call) => call.body.recipient_id),
      USERS,
    );
    for (const call of relay.discord.calls) assert.equal(call.authorization, `Bot ${BOT}`);
    assert.equal(messages[0].body.content, formatAlert(DOWN));
    assert.deepEqual(messages[0].body.allowed_mentions, { parse: [] });
    assert.equal(relay.lines.length, 1);
    assert.ok(relay.lines[0].includes(`«${NAME}» → доставлено 2 из 2`));
    // В журнале нет ни секрета, ни токена бота.
    assert.ok(!relay.lines.join('\n').includes(TOKEN));
    assert.ok(!relay.lines.join('\n').includes(BOT));
  } finally {
    await relay.stop();
  }
});

const ONE = { ...ENV, ALERT_DISCORD_USER_IDS: USERS[0] };

test('ретранслятор: сетевая ошибка, 5xx и 429 повторяются; 429 ждёт retry_after', async () => {
  const relay = await startRelay(
    { channels: ['throw', 500, 200], messages: [429, 200] },
    { env: ONE },
  );
  try {
    assert.equal((await relay.post(DOWN)).status, 200);
    // Личка открывается один раз даже после ошибки отправки.
    assert.deepEqual(
      relay.discord.calls.map((call) => call.path),
      [
        '/users/@me/channels',
        '/users/@me/channels',
        '/users/@me/channels',
        messagePath(USERS[0]),
        messagePath(USERS[0]),
      ],
    );
    // retry_after короче паузы повтора — берётся пауза.
    assert.deepEqual(relay.pauses, [1000, 4000, 1000, 1200]);
  } finally {
    await relay.stop();
  }
  const patient = await startRelay({ messages: [429, 200], retryAfter: 3 }, { env: ONE });
  try {
    assert.equal((await patient.post(DOWN)).status, 200);
    // retry_after длиннее паузы повтора — ждём, сколько просит Discord.
    assert.deepEqual(patient.pauses, [3000, 1200]);
  } finally {
    await patient.stop();
  }
});

test('ретранслятор: окончательный отказ Discord даёт 502 и не бросает остальных получателей', async () => {
  const relay = await startRelay({ messages: [403, 200] });
  try {
    const response = await relay.post(DOWN);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false });
    assert.equal(relay.discord.calls.filter((call) => call.path.endsWith('/messages')).length, 2);
    assert.ok(relay.lines[0].includes('доставлено 1 из 2'));
    assert.ok(relay.lines[0].includes('Discord отклонила сообщение (HTTP 403)'));
    // После отказа очередь не застревает: следующее оповещение доставляется.
    assert.equal((await relay.post(DOWN)).status, 200);
  } finally {
    await relay.stop();
  }
});

test('ретранслятор: неверный токен бота — без повторов; вечные 5xx — три повтора и 502', async () => {
  const unauthorized = await startRelay({ channels: [401] }, { env: ONE });
  try {
    assert.equal((await unauthorized.post(DOWN)).status, 502);
    assert.equal(unauthorized.discord.calls.length, 1);
    assert.deepEqual(unauthorized.pauses, [1200]);
    assert.ok(unauthorized.lines[0].includes('Discord не открыла личку (HTTP 401)'));
  } finally {
    await unauthorized.stop();
  }
  const exhausted = await startRelay({ messages: [500] }, { env: ONE });
  try {
    assert.equal((await exhausted.post(DOWN)).status, 502);
    assert.equal(
      exhausted.discord.calls.filter((call) => call.path.endsWith('/messages')).length,
      4,
    );
    assert.deepEqual(exhausted.pauses, [1000, 4000, 10_000, 1200]);
    assert.ok(exhausted.lines[0].includes('после 4 попыток (HTTP 500)'));
  } finally {
    await exhausted.stop();
  }
});

test('ретранслятор: одновременные оповещения уходят по одному, с паузой между ними', async () => {
  const relay = await startRelay({});
  try {
    const responses = await Promise.all([
      relay.post(DOWN),
      relay.post({ ...DOWN, monitor: { name: 'Второй монитор' } }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200],
    );
    // Второе оповещение не начинается, пока первое не доставлено всем получателям.
    assert.deepEqual(
      relay.discord.calls.map((call) => call.path),
      [
        '/users/@me/channels',
        messagePath(USERS[0]),
        '/users/@me/channels',
        messagePath(USERS[1]),
        '/users/@me/channels',
        messagePath(USERS[0]),
        '/users/@me/channels',
        messagePath(USERS[1]),
      ],
    );
    assert.deepEqual(relay.pauses, [1200, 1200]);
  } finally {
    await relay.stop();
  }
});
