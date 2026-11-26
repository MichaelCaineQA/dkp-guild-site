// Юнит-тесты сценария настройки Uptime Kuma (#305):
//   node --test scripts/monitoring/kuma-setup.test.mjs
//
// Kuma заменена накопителем, который говорит по тому же протоколу Socket.IO,
// что и сценарий. Настоящая Kuma проверяется в workflow Infrastructure.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MONITOR_TEMPLATE,
  POLICY,
  apply,
  buildMonitors,
  buildNotifications,
  changedFields,
  connect,
  encodeEvent,
  formatReport,
  formatTime,
  main,
  monitorPayload,
  parseFrame,
  readConfig,
  socketUrl,
} from './kuma-setup.mjs';

const PASSWORD = 'test-password-123';
const WEBHOOK = 'https://discord.com/api/webhooks/1/secret-token';
const PRODUCTION = [
  'Прод: API — здоровье',
  'Прод: сайт — страница входа',
  'Прод: WebSocket (аукцион)',
];
const STAGING = [
  'Стенд: API — здоровье',
  'Стенд: сайт — страница входа',
  'Стенд: WebSocket (аукцион)',
];
const ENV = {
  KUMA_PASSWORD: PASSWORD,
  KUMA_PRODUCTION_HOST: 'prod.example.test',
  KUMA_STAGING_HOST: 'stage.example.test',
};

/** Накопитель с поведением сервера Kuma 2.5 по событиям, которые использует сценарий. */
class FakeKuma {
  constructor({ needSetup = false } = {}) {
    this.needSetup = needSetup;
    this.users = new Map();
    this.monitors = new Map();
    this.notifications = new Map();
    this.writes = [];
    this.tests = [];
    this.rejectEvent = null;
    this.rejectMessage = '';
    this.nextId = 1;
    // Как у настоящей Kuma: обработчики событий появляются только после события info.
    this.readySockets = new WeakSet();
  }

  /** @returns {Function} класс сокета, привязанный к этому накопителю */
  socketClass() {
    const server = this;
    return class FakeSocket extends EventTarget {
      constructor(url, options) {
        super();
        this.url = String(url);
        this.options = options;
        this.sent = [];
        this.closed = false;
        queueMicrotask(() => this.receive('0{"sid":"engine"}'));
      }

      receive(text) {
        if (this.closed) return;
        this.dispatchEvent(new MessageEvent('message', { data: text }));
      }

      emit(event, ...args) {
        this.receive(`42${JSON.stringify([event, ...args])}`);
      }

      send(text) {
        this.sent.push(text);
        if (text === '3') return;
        if (text === '40') {
          queueMicrotask(() => {
            this.receive('40{"sid":"socket"}');
            setTimeout(() => {
              this.emit('info', { serverTimezone: 'Europe/Moscow' });
              server.readySockets.add(this);
            }, 0);
          });
          return;
        }
        const frame = parseFrame(text);
        assert.equal(frame.kind, 'event', `не событие: ${text}`);
        queueMicrotask(() => {
          if (this.closed) return;
          server.handle(this, frame);
        });
      }

      close() {
        if (this.closed) return;
        this.closed = true;
        this.dispatchEvent(new Event('close'));
      }
    };
  }

  handle(socket, frame) {
    const [first, second] = frame.args;
    const reply = (result) => socket.receive(`43${frame.id}${JSON.stringify([result])}`);
    if (!this.readySockets.has(socket)) return;
    if (this.rejectEvent === frame.event) {
      return reply({ ok: false, msg: this.rejectMessage });
    }
    switch (frame.event) {
      case 'needSetup':
        return reply(this.needSetup);
      case 'setup':
        if (this.users.has(first)) return reply({ ok: false, msg: 'already' });
        this.users.set(first, second);
        this.needSetup = false;
        this.writes.push(['setup', first]);
        return reply({ ok: true });
      case 'login':
        if (this.users.get(first.username) !== first.password) {
          return reply({ ok: false, msg: 'authIncorrectCreds' });
        }
        socket.emit('info', { version: '2.5.12-test', serverTimezone: 'Europe/Moscow' });
        socket.emit('monitorList', Object.fromEntries(this.monitors));
        socket.emit('notificationList', [...this.notifications.values()]);
        for (const [id, monitor] of this.monitors) {
          socket.emit('heartbeatList', id, monitor.beats ?? []);
        }
        return reply({ ok: true, token: 'jwt' });
      case 'getMonitorList':
        socket.emit('monitorList', Object.fromEntries(this.monitors));
        return reply({ ok: true });
      case 'getMonitor':
        return this.monitors.has(first)
          ? reply({ ok: true, monitor: this.monitors.get(first) })
          : reply({ ok: false, msg: 'not found' });
      case 'add': {
        const id = this.nextId++;
        this.monitors.set(id, { id, ...first });
        this.writes.push(['add', first.name]);
        return reply({ ok: true, monitorID: id });
      }
      case 'editMonitor':
        this.monitors.set(first.id, { ...this.monitors.get(first.id), ...first });
        this.writes.push(['editMonitor', first.name]);
        return reply({ ok: true });
      case 'deleteMonitor':
        this.writes.push(['deleteMonitor', this.monitors.get(first)?.name]);
        this.monitors.delete(first);
        return reply({ ok: true });
      case 'addNotification': {
        const id = second ?? this.nextId++;
        this.notifications.set(id, { id, name: first.name, config: JSON.stringify(first) });
        this.writes.push(['addNotification', first.name]);
        socket.emit('notificationList', [...this.notifications.values()]);
        return reply({ ok: true, id });
      }
      case 'deleteNotification':
        // Как у настоящей Kuma: привязки удалённого канала снимаются с мониторов каскадом.
        this.writes.push(['deleteNotification', this.notifications.get(first)?.name]);
        this.notifications.delete(first);
        for (const monitor of this.monitors.values()) {
          if (monitor.notificationIDList) delete monitor.notificationIDList[first];
        }
        socket.emit('notificationList', [...this.notifications.values()]);
        return reply({ ok: true });
      case 'testNotification':
        this.tests.push(first);
        return reply({ ok: true, msg: 'Sent Successfully.' });
      default:
        return reply({ ok: false, msg: `unknown event ${frame.event}` });
    }
  }

  /** @returns {Promise<import('./kuma-setup.mjs').KumaClient>} */
  async connect() {
    return connect('ws://uptime-kuma:3001', { WebSocketImpl: this.socketClass() });
  }

  /** Добавляет монитор, как будто его создали руками в панели. */
  seedMonitor(fields) {
    const id = this.nextId++;
    this.monitors.set(id, { id, active: true, beats: [], ...fields });
    return id;
  }
}

async function withKuma(options, env, run) {
  const kuma = new FakeKuma(options);
  // На уже настроенной Kuma администратор существует.
  if (!kuma.needSetup) kuma.users.set('admin', PASSWORD);
  const client = await kuma.connect();
  try {
    return await run(client, kuma, readConfig({ ...ENV, ...env }));
  } finally {
    client.close();
  }
}

// Вывод main() и заглушки транспорта: Kuma отвечает, что база уже выбрана.
function collect(fetchImpl = async () => ({ json: async () => ({ needSetup: false }) })) {
  const chunks = [];
  return {
    chunks,
    fetchImpl,
    stdout: { write: (chunk) => chunks.push(chunk) },
    stderr: { write: (chunk) => chunks.push(chunk) },
  };
}

test('политика: проверка раз в минуту, тревога на четвёртой неудаче подряд', () => {
  assert.deepEqual(
    { ...POLICY },
    { interval: 60, retryInterval: 60, retries: 3, resendInterval: 120, timeout: 10 },
  );
});

test('readConfig: значения по умолчанию и проверка переменных', () => {
  const config = readConfig({ KUMA_PASSWORD: PASSWORD });
  assert.equal(config.url, 'ws://uptime-kuma:3001');
  assert.equal(config.username, 'admin');
  assert.equal(config.productionHost, 'suneclipse.ru');
  assert.equal(config.stagingHost, '');
  assert.equal(config.stagingNotifications, false);
  assert.equal(config.smtp.port, '587');
  assert.equal(config.smtp.secure, false);
  assert.throws(() => readConfig({}), /KUMA_PASSWORD/);
  const bad = [
    [{ KUMA_PRODUCTION_HOST: 'https://x.ru/' }, /KUMA_PRODUCTION_HOST/],
    [{ KUMA_STAGING_HOST: 'stage.ru:443' }, /KUMA_STAGING_HOST/],
    [{ KUMA_DISCORD_WEBHOOK_URL: 'http://x.test' }, /KUMA_DISCORD_WEBHOOK_URL/],
    [{ KUMA_SMTP_PORT: 'smtp' }, /KUMA_SMTP_PORT/],
    [{ KUMA_URL: 'uptime-kuma' }, /KUMA_URL/],
  ];
  for (const [env, pattern] of bad) {
    assert.throws(() => readConfig({ KUMA_PASSWORD: PASSWORD, ...env }), pattern);
  }
});

test('buildMonitors: production всегда, стенд только с хостом и молча по умолчанию', () => {
  const config = readConfig(ENV);
  const monitors = buildMonitors(config);
  assert.deepEqual(
    [...monitors].map((monitor) => monitor.name),
    [...PRODUCTION, ...STAGING],
  );
  const [health, page, socket] = monitors;
  assert.equal(health.url, 'https://prod.example.test/api/health');
  assert.equal(health.type, 'json-query');
  assert.equal(health.jsonPath, 'status & " " & db');
  assert.equal(health.jsonPathOperator, '==');
  assert.equal(health.expectedValue, 'ok up');
  assert.equal(health.expiryNotification, true);
  assert.equal(page.type, 'http');
  assert.equal(page.url, 'https://prod.example.test/');
  assert.equal(page.expiryNotification, undefined);
  assert.equal(socket.type, 'websocket-upgrade');
  assert.equal(socket.url, 'wss://prod.example.test/api/socket.io/?EIO=4&transport=websocket');
  assert.deepEqual(socket.accepted_statuscodes, ['1000']);
  assert.ok(monitors.slice(0, 3).every((monitor) => monitor.notify));
  assert.ok(monitors.slice(3).every((monitor) => !monitor.notify));
  const loud = buildMonitors({ ...config, stagingNotifications: true });
  assert.ok(loud.slice(3).every((monitor) => monitor.notify));
  assert.deepEqual(
    buildMonitors({ ...config, stagingHost: '' }).map((monitor) => monitor.name),
    PRODUCTION,
  );
});

test('buildNotifications: пусто без канала, Discord и почта — что задано', () => {
  assert.deepEqual(buildNotifications(readConfig(ENV)), []);
  const discord = buildNotifications({ ...readConfig(ENV), discordWebhookUrl: WEBHOOK });
  assert.equal(discord.length, 1);
  assert.equal(discord[0].type, 'discord');
  assert.equal(discord[0].name, 'DKP: Discord');
  assert.equal(discord[0].discordWebhookUrl, WEBHOOK);
  const smtp = { host: 'smtp.example.test', to: 'a@b.test' };
  assert.throws(
    () => buildNotifications({ ...readConfig(ENV), smtp: { host: 'smtp.example.test' } }),
    /KUMA_SMTP_TO/,
  );
  assert.throws(() => buildNotifications({ ...readConfig(ENV), smtp }), /KUMA_SMTP_FROM/);
  assert.deepEqual(
    buildNotifications({
      ...readConfig(ENV),
      smtp: { ...smtp, port: '465', secure: true, username: 'u', password: 'p' },
    }),
    [
      {
        name: 'DKP: почта',
        type: 'smtp',
        smtpHost: 'smtp.example.test',
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: 'u',
        smtpPassword: 'p',
        smtpFrom: 'u',
        smtpTo: 'a@b.test',
      },
    ],
  );
});

test('monitorPayload: общий порог, привязка уведомления и все поля формы', () => {
  const [health] = buildMonitors(readConfig(ENV));
  const payload = monitorPayload(health, [7]);
  for (const key of Object.keys(MONITOR_TEMPLATE)) {
    assert.ok(key in payload, `нет поля ${key}`);
  }
  assert.equal(payload.active, true);
  assert.equal(payload.interval, 60);
  assert.equal(payload.retryInterval, 60);
  assert.equal(payload.maxretries, 3);
  assert.equal(payload.resendInterval, 120);
  assert.equal(payload.timeout, 10);
  assert.deepEqual(payload.notificationIDList, { 7: true });
  assert.equal(payload.expiryNotification, true);
  assert.equal(payload.domainExpiryNotification, false);
  assert.deepEqual(payload.accepted_statuscodes, ['200-299']);
  assert.equal(payload.jsonPathOperator, '==');
  // Шаблон общий — правка одного монитора не меняет остальных.
  payload.kafkaProducerSaslOptions.mechanism = 'plain';
  assert.equal(monitorPayload(health, []).kafkaProducerSaslOptions.mechanism, 'None');
});

test('changedFields: пусто при совпадении, иначе имена полей', () => {
  const [health] = buildMonitors(readConfig(ENV));
  const payload = monitorPayload(health, []);
  assert.deepEqual(changedFields({ ...payload }, payload), []);
  assert.deepEqual(
    changedFields({ ...payload, maxretries: 0, url: 'https://other' }, payload).sort(),
    ['maxretries', 'url'],
  );
  assert.deepEqual(changedFields({ ...payload, notificationIDList: { 1: true } }, payload), [
    'notificationIDList',
  ]);
  assert.deepEqual(
    changedFields({ ...payload, notificationIDList: { 1: true } }, payload, ['notificationIDList']),
    [],
  );
  assert.deepEqual(changedFields({ ...payload, accepted_statuscodes: ['1000'] }, payload), [
    'accepted_statuscodes',
  ]);
});

test('socketUrl: любой адрес панели превращается в Engine.IO 4', () => {
  const query = '/socket.io/?EIO=4&transport=websocket';
  assert.equal(socketUrl('ws://uptime-kuma:3001'), `ws://uptime-kuma:3001${query}`);
  assert.equal(socketUrl('ws://uptime-kuma:3001/'), `ws://uptime-kuma:3001${query}`);
  assert.equal(socketUrl('https://status.example.ru'), `wss://status.example.ru${query}`);
  assert.equal(
    socketUrl('wss://status.example.ru/socket.io/?EIO=4&transport=polling'),
    `wss://status.example.ru${query}`,
  );
});

test('formatTime: время Kuma — UTC без зоны; в панель попадает время пояса панели', () => {
  // Разбор даты зависит от пояса процесса: берём заведомо другой, чтобы ошибка проявилась.
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    assert.equal(formatTime('2026-11-26 12:00:00.000', 'Europe/Moscow'), '26.11.2026, 15:00:00');
    assert.equal(formatTime('2026-11-26T12:00:00.000Z', 'Europe/Moscow'), '26.11.2026, 15:00:00');
    assert.equal(formatTime('2026-11-26T15:00:00+03:00', 'Europe/Moscow'), '26.11.2026, 15:00:00');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  assert.equal(formatTime('not a date', 'Europe/Moscow'), 'not a date');
});

test('кадры Socket.IO: события, подтверждения, ping и чужие кадры', () => {
  assert.deepEqual(parseFrame('0{"sid":"e"}'), { kind: 'open' });
  assert.deepEqual(parseFrame('2'), { kind: 'ping' });
  assert.deepEqual(parseFrame('3'), { kind: 'pong' });
  assert.deepEqual(parseFrame('40{"sid":"s"}'), { kind: 'connect' });
  assert.deepEqual(parseFrame('44{"message":"forbidden"}'), {
    kind: 'connect_error',
    data: { message: 'forbidden' },
  });
  assert.deepEqual(parseFrame('42["heartbeatList",3,[{"status":1}]]'), {
    kind: 'event',
    id: null,
    event: 'heartbeatList',
    args: [3, [{ status: 1 }]],
  });
  assert.deepEqual(parseFrame('425["login",{"username":"a"}]'), {
    kind: 'event',
    id: 5,
    event: 'login',
    args: [{ username: 'a' }],
  });
  assert.deepEqual(parseFrame('42/admin,7["evt"]'), {
    kind: 'event',
    id: 7,
    event: 'evt',
    args: [],
  });
  assert.deepEqual(parseFrame('4312[{"ok":true,"monitorID":3}]'), {
    kind: 'ack',
    id: 12,
    args: [{ ok: true, monitorID: 3 }],
  });
  assert.deepEqual(parseFrame('8{"sid":"x"}'), { kind: 'other', text: '8{"sid":"x"}' });
  assert.deepEqual(parseFrame(encodeEvent(9, 'add', [{ name: 'x' }, null])), {
    kind: 'event',
    id: 9,
    event: 'add',
    args: [{ name: 'x' }, null],
  });
});

test('apply: первый запуск создаёт администратора, уведомление и мониторы', async () => {
  await withKuma(
    { needSetup: true },
    { KUMA_DISCORD_WEBHOOK_URL: WEBHOOK },
    async (client, kuma, config) => {
      const report = await apply(client, config);
      assert.equal(report.setup, 'created');
      assert.equal(kuma.users.get('admin'), PASSWORD);
      assert.deepEqual(report.notifications.created, ['DKP: Discord']);
      assert.equal(report.silent, false);
      assert.equal(kuma.monitors.size, 6);
      assert.equal(report.monitors.created.length, 6);
      assert.equal(report.monitors.updated.length + report.monitors.unchanged.length, 0);
      for (const monitor of kuma.monitors.values()) {
        const bound = monitor.name.startsWith('Прод: ') ? { 1: true } : {};
        assert.deepEqual(monitor.notificationIDList, bound);
      }
    },
  );
});

test('apply: повторный запуск ничего не меняет', async () => {
  await withKuma({}, { KUMA_DISCORD_WEBHOOK_URL: WEBHOOK }, async (client, kuma, config) => {
    await apply(client, config);
    kuma.writes.length = 0;
    const report = await apply(client, config);
    assert.deepEqual(kuma.writes, []);
    assert.equal(report.setup, 'existing');
    assert.deepEqual(report.notifications.unchanged, ['DKP: Discord']);
    assert.equal(report.monitors.created.length + report.monitors.updated.length, 0);
    assert.equal(report.monitors.deleted.length, 0);
    assert.equal(report.monitors.unchanged.length, 6);
  });
});

test('apply: без канала мониторы молчат, чужие записи не трогаются', async () => {
  await withKuma({}, {}, async (client, kuma, config) => {
    const own = kuma.seedMonitor({ name: 'Мой монитор', type: 'http', url: 'https://x.test' });
    kuma.notifications.set(5, { id: 5, name: 'Личное', config: '{"type":"smtp"}' });
    kuma.notifications.set(6, {
      id: 6,
      name: 'DKP: Discord',
      config: '{"type":"discord","discordWebhookUrl":"https://discord.com/api/webhooks/9/old"}',
    });
    const report = await apply(client, config);
    assert.equal(report.silent, true);
    assert.ok(formatReport(report).includes('Канал оповещений не задан'));
    assert.equal(kuma.monitors.size, 7);
    assert.deepEqual(kuma.monitors.get(own), {
      id: own,
      active: true,
      beats: [],
      name: 'Мой монитор',
      type: 'http',
      url: 'https://x.test',
    });
    // Канал, которого больше нет в окружении, удаляется; чужое уведомление остаётся.
    assert.deepEqual(report.notifications.deleted, ['DKP: Discord']);
    assert.deepEqual(
      [...kuma.notifications.values()].map((item) => item.name),
      ['Личное'],
    );
    assert.ok(
      [...kuma.monitors.values()].every(
        (monitor) => !monitor.notificationIDList || !Object.keys(monitor.notificationIDList).length,
      ),
    );
  });
});

test('apply: смена настроек обновляет мониторы и привязку, выключение стенда удаляет его мониторы', async () => {
  await withKuma({}, { KUMA_DISCORD_WEBHOOK_URL: WEBHOOK }, async (client, kuma, config) => {
    await apply(client, config);
    kuma.writes.length = 0;
    const moved = {
      ...config,
      productionHost: 'new.example.test',
      stagingNotifications: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/2/other',
    };
    const report = await apply(client, moved);
    assert.deepEqual(report.notifications.updated, ['DKP: Discord']);
    assert.equal(kuma.notifications.size, 1);
    assert.equal(report.monitors.updated.length, 6);
    assert.equal(report.monitors.updated[0], 'Прод: API — здоровье (url, description)');
    assert.ok(report.monitors.updated[3].endsWith('(notificationIDList)'));
    assert.equal(kuma.monitors.size, 6);
    for (const monitor of kuma.monitors.values()) {
      assert.deepEqual(Object.keys(monitor.notificationIDList), ['1']);
      const host = monitor.name.startsWith('Прод: ') ? 'new.example.test' : 'stage.example.test';
      assert.ok(monitor.url.includes(host), monitor.url);
    }

    kuma.writes.length = 0;
    const off = await apply(client, { ...moved, stagingHost: '' });
    assert.deepEqual([...off.monitors.deleted].sort(), [...STAGING].sort());
    assert.deepEqual(
      kuma.writes.map(([event]) => event),
      ['deleteMonitor', 'deleteMonitor', 'deleteMonitor'],
    );
    assert.deepEqual(
      [...kuma.monitors.values()].map((monitor) => monitor.name).sort(),
      [...PRODUCTION].sort(),
    );

    // Канал убрали из окружения: уведомление удаляется, Kuma сама снимает его
    // привязку с мониторов каскадом — сами мониторы менять не приходится.
    kuma.writes.length = 0;
    const quiet = await apply(client, { ...moved, stagingHost: '', discordWebhookUrl: '' });
    assert.deepEqual(quiet.notifications.deleted, ['DKP: Discord']);
    assert.equal(kuma.notifications.size, 0);
    assert.equal(quiet.monitors.updated.length, 0);
    assert.equal(quiet.monitors.unchanged.length, 3);
    assert.deepEqual(
      kuma.writes.map(([event]) => event),
      ['deleteNotification'],
    );
    assert.ok(
      [...kuma.monitors.values()].every(
        (monitor) => !Object.keys(monitor.notificationIDList).length,
      ),
    );
  });
});

test('apply: план ничего не записывает', async () => {
  await withKuma({ needSetup: true }, {}, async (client, kuma, config) => {
    const fresh = await apply(client, config, { dryRun: true });
    assert.equal(fresh.setup, 'planned');
    assert.deepEqual(kuma.writes, []);
    assert.equal(kuma.users.size, 0);
  });
  await withKuma({}, {}, async (client, kuma, config) => {
    await apply(client, config);
    kuma.writes.length = 0;
    const report = await apply(
      client,
      {
        ...config,
        productionHost: 'new.example.test',
        stagingHost: '',
        discordWebhookUrl: WEBHOOK,
      },
      { dryRun: true },
    );
    assert.deepEqual(kuma.writes, []);
    assert.equal(report.setup, 'existing');
    assert.deepEqual(report.notifications.created, ['DKP: Discord']);
    // Идентификатор ещё не созданного уведомления неизвестен — привязку в план не пишем.
    assert.deepEqual(
      report.monitors.updated,
      PRODUCTION.map((name) => `${name} (url, description)`),
    );
    assert.deepEqual([...report.monitors.deleted].sort(), [...STAGING].sort());
    assert.equal(kuma.monitors.size, 6);
    assert.ok(formatReport(report).includes('план, ничего не записано'));

    // План на удаление канала ничего не трогает; привязку мониторов не помечает
    // изменённой: настоящий запуск сменит её каскадом, без правки самих мониторов.
    kuma.notifications.set(4, { id: 4, name: 'DKP: Discord', config: '{"type":"discord"}' });
    kuma.monitors.get(1).notificationIDList = { 4: true };
    kuma.writes.length = 0;
    const removal = await apply(client, { ...config, discordWebhookUrl: '' }, { dryRun: true });
    assert.deepEqual(removal.notifications.deleted, ['DKP: Discord']);
    assert.equal(removal.monitors.updated.length, 0);
    assert.equal(removal.monitors.unchanged.length, 6);
    assert.deepEqual(kuma.writes, []);
    assert.equal(kuma.notifications.get(4).name, 'DKP: Discord');
  });
});

test('apply: ошибка Kuma прерывает сценарий с названием шага', async () => {
  await withKuma({}, {}, async (client, kuma, config) => {
    kuma.rejectEvent = 'add';
    kuma.rejectMessage = 'boom';
    await assert.rejects(
      apply(client, config),
      /Монитор «Прод: API — здоровье»: Kuma ответила «boom»/,
    );
    assert.equal(kuma.monitors.size, 0);
  });
});

test('apply: неверный пароль не меняет ничего', async () => {
  await withKuma({}, {}, async (client, kuma, config) => {
    kuma.users.set('admin', 'other-password');
    await assert.rejects(apply(client, config), /Вход в Kuma: Kuma ответила «authIncorrectCreds»/);
    assert.deepEqual(kuma.writes, []);
  });
});

test('main: отчёт в stdout, секреты не печатаются', async () => {
  const kuma = new FakeKuma({ needSetup: true });
  const output = collect();
  const code = await main(
    ['apply'],
    { ...ENV, KUMA_DISCORD_WEBHOOK_URL: WEBHOOK },
    {
      ...output,
      WebSocketImpl: kuma.socketClass(),
    },
  );
  assert.equal(code, 0);
  const text = output.chunks.join('');
  assert.ok(text.includes('ИТОГ (записано): создано 6, изменено 0, удалено 0, без изменений 0'));
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!text.includes('secret-token'));
  assert.equal(kuma.monitors.size, 6);
});

test('main: статус показывает только мониторы сценария; пробное сообщение уходит в канал', async () => {
  const kuma = new FakeKuma();
  kuma.users.set('admin', PASSWORD);
  kuma.seedMonitor({
    name: PRODUCTION[0],
    type: 'json-query',
    beats: [{ status: 1, time: '2026-11-26T12:00:00.000Z', ping: 42, msg: '200 - OK' }],
  });
  kuma.seedMonitor({ name: PRODUCTION[1], type: 'http', active: false });
  kuma.seedMonitor({ name: 'Чужой', type: 'http', beats: [{ status: 0, time: 'x', msg: 'fail' }] });
  const output = collect();
  const options = { ...output, WebSocketImpl: kuma.socketClass() };
  const env = { ...ENV, stagingHost: '', KUMA_DISCORD_WEBHOOK_URL: WEBHOOK };
  assert.equal(await main(['status'], env, options), 0);
  const text = output.chunks.join('');
  assert.ok(text.includes('Kuma 2.5.12-test'));
  assert.ok(text.includes('Прод: API — здоровье: UP, 26.11.2026, 15:00:00, 42 мс 200 - OK'));
  assert.ok(text.includes('Прод: сайт — страница входа: PAUSED\n'));
  assert.ok(!text.includes('Чужой'));

  output.chunks.length = 0;
  assert.equal(await main(['test-notification'], env, options), 0);
  assert.equal(output.chunks.join(''), '«DKP: Discord»: Sent Successfully.\n');
  assert.equal(kuma.tests[0].discordWebhookUrl, WEBHOOK);
});

test('main: неизвестная команда и ошибка конфигурации дают код 2', async () => {
  const output = collect();
  assert.equal(await main(['wrong'], {}, output), 2);
  assert.ok(output.chunks.join('').includes('Использование'));
  output.chunks.length = 0;
  assert.equal(await main(['status'], { KUMA_PRODUCTION_HOST: 'bad host' }, output), 2);
  assert.ok(output.chunks.join('').includes('KUMA_PRODUCTION_HOST'));
});

test('connect: отказ сокета виден сразу и не печатает секрет', async () => {
  const output = collect();
  const refused = class extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => {
        this.dispatchEvent(new Event('error'));
        this.dispatchEvent(new Event('close'));
      });
    }
    close() {}
  };
  const code = await main(
    ['status'],
    { ...ENV, KUMA_PASSWORD: 'short' },
    { ...output, WebSocketImpl: refused },
  );
  assert.equal(code, 1);
  const text = output.chunks.join('');
  assert.match(text, /Не удалось соединиться с Kuma|закрылось до (готовности|ответа)/);
  assert.ok(!text.includes('short'));
});

test('main: мастер выбора базы объясняет себя, а не висит до таймаута', async () => {
  let sockets = 0;
  const wizard = collect(async () => ({ json: async () => ({ needSetup: true }) }));
  const untouched = class extends EventTarget {
    constructor() {
      super();
      sockets += 1;
    }
    close() {}
  };
  assert.equal(await main(['apply'], ENV, { ...wizard, WebSocketImpl: untouched }), 1);
  assert.equal(sockets, 0);
  assert.ok(wizard.chunks.join('').includes('Kuma ждёт выбора базы данных'));
});

test('connect: готовность — событие info, иначе первый запрос теряется (гонка Kuma)', async () => {
  // Накопитель, как настоящая Kuma, молча выбрасывает события, присланные до info.
  const kuma = new FakeKuma();
  const client = await kuma.connect();
  try {
    assert.equal(await client.emit('needSetup'), false);
    assert.ok(client.socket.sent.includes('420["needSetup"]'));
  } finally {
    client.close();
  }
});

test('--verbose: след обмена без аргументов — пароль и вебхук не печатаются', async () => {
  const kuma = new FakeKuma({ needSetup: true });
  const output = collect();
  const code = await main(
    ['apply', '--verbose'],
    { ...ENV, KUMA_DISCORD_WEBHOOK_URL: WEBHOOK },
    {
      ...output,
      WebSocketImpl: kuma.socketClass(),
    },
  );
  assert.equal(code, 0);
  const text = output.chunks.join('');
  assert.ok(text.includes('← open; → namespace connect'));
  assert.ok(text.includes('→ needSetup #0'));
  assert.ok(text.includes('← ack #0'));
  assert.ok(text.includes('→ setup #1'));
  assert.ok(text.includes('→ login #2'));
  assert.ok(text.includes('← event info'));
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!text.includes('secret-token'));
});
