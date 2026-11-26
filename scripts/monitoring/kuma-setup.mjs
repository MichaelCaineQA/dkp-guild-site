#!/usr/bin/env node
/**
 * Настройка Uptime Kuma для мониторинга сайта (#305): учётная запись
 * администратора, уведомления и мониторы с общим порогом тревоги.
 *
 *   node scripts/monitoring/kuma-setup.mjs [apply|status|test-notification] [флаги]
 *
 *     apply               привести Kuma в соответствие окружению (по умолчанию);
 *                         --dry-run только печатает план, ничего не записывая
 *     status              последние проверки мониторов сценария; --watch N печатает
 *                         новые проверки N секунд подряд (замер порога, диагностика)
 *     test-notification   пробное сообщение каждым настроенным каналом
 *
 * На сервере нет Node.js — там сценарий запускает scripts/monitoring/kuma-setup.sh
 * образом самой Kuma. Зависимостей нет: протокол Socket.IO (Engine.IO 4)
 * реализован поверх встроенного в Node.js 22+ WebSocket. Внутренний интерфейс
 * Kuma не документирован, поэтому версия образа зафиксирована в
 * docker-compose.monitoring.yml, а workflow Infrastructure прогоняет сценарий
 * на настоящей Kuma.
 *
 * Своими сценарий считает только мониторы и уведомления с перечисленных ниже
 * имён: приводит их к описанию и удаляет ненужные; остальное в Kuma не трогает.
 * Секреты читаются из окружения и не выводятся. Образец — .env.monitoring.example.
 */

import { pathToFileURL } from 'node:url';

/** Общий порог всех мониторов (секунды и число проверок), PLAN.md §8, этап 7. */
export const POLICY = Object.freeze({
  // Между проверками, пока сайт доступен.
  interval: 60,
  // Между повторами, когда проверка уже не прошла.
  retryInterval: 60,
  // Неудачных проверок подряд до тревоги: тревога на следующей за ними, четвёртой,
  // то есть через три минуты после первой неудачи. Штатный деплой останавливает
  // API на 10–40 секунд (снимок, миграции, seed) и тревоги не даёт.
  retries: 3,
  // Повтор оповещения, пока авария длится: столько проверок подряд (2 часа); 0 — не повторять.
  resendInterval: 120,
  // На одну проверку.
  timeout: 10,
});

const NOTIFICATIONS = Object.freeze({ discord: 'DKP: Discord', smtp: 'DKP: почта' });

const OWNED_NOTIFICATION_NAMES = Object.freeze(Object.values(NOTIFICATIONS));

const PREFIX = Object.freeze({ production: 'Прод: ', staging: 'Стенд: ' });

const STATUS = Object.freeze({ 0: 'DOWN', 1: 'UP', 2: 'PENDING', 3: 'MAINTENANCE' });

const COMMANDS = ['apply', 'status', 'test-notification'];

// Поля, по которым текущий монитор сверяется с желаемым.
const MONITOR_FIELDS = Object.freeze([
  'type',
  'url',
  'description',
  'interval',
  'retryInterval',
  'maxretries',
  'resendInterval',
  'timeout',
  'expiryNotification',
  'domainExpiryNotification',
  'accepted_statuscodes',
  'jsonPath',
  'jsonPathOperator',
  'expectedValue',
  'notificationIDList',
]);

// Все поля формы монитора Kuma 2.5: сервер сохраняет присланный объект как есть
// и без полей, которых нет в запросе, строка не проходит проверку базы.
export const MONITOR_TEMPLATE = Object.freeze({
  parent: null,
  wsSubprotocol: '',
  method: 'GET',
  protocol: null,
  location: 'world',
  ipFamily: null,
  retryOnlyOnStatusCodeFailure: false,
  ignoreTls: false,
  upsideDown: false,
  maxredirects: 10,
  saveResponse: false,
  saveErrorResponse: true,
  responseMaxLength: 1024,
  dns_resolve_type: 'A',
  dns_resolve_server: '',
  docker_container: '',
  docker_host: null,
  proxyId: null,
  basic_auth_user: '',
  basic_auth_pass: '',
  bearer_token: '',
  mqttUsername: '',
  mqttPassword: '',
  mqttTopic: '',
  mqttWebsocketPath: '',
  mqttSuccessMessage: '',
  mqttCheckType: 'keyword',
  authMethod: null,
  oauth_auth_method: 'client_secret_basic',
  httpBodyEncoding: 'json',
  kafkaProducerBrokers: [],
  kafkaProducerSaslOptions: { mechanism: 'None' },
  cacheBust: false,
  kafkaProducerSsl: false,
  kafkaProducerAllowAutoTopicCreation: false,
  gamedigGivenPortOnly: true,
  gamedigToken: '',
  remote_browser: null,
  screenshot_delay: 0,
  rabbitmqNodes: [],
  rabbitmqUsername: '',
  rabbitmqPassword: '',
  conditions: [],
  system_service_name: '',
  sshAuthMethod: 'password',
  ntpStratumThreshold: 5,
  ntpTimeOffsetThreshold: 1000,
  ntpRootDispersionThreshold: 500,
  ping_count: 3,
  ping_numeric: true,
  packetSize: 56,
  ping_per_request_timeout: 2,
});

// ---------------------------------------------------------------------------
// Желаемое состояние
// ---------------------------------------------------------------------------

/**
 * Читает и проверяет переменные окружения сценария.
 * @param {Record<string, string | undefined>} env
 * @returns {object}
 */
export function readConfig(env) {
  const value = (name) => (env[name] ?? '').trim();
  const config = {
    url: value('KUMA_URL') || 'ws://uptime-kuma:3001',
    username: value('KUMA_USERNAME') || 'admin',
    password: value('KUMA_PASSWORD'),
    productionHost: value('KUMA_PRODUCTION_HOST') || 'suneclipse.ru',
    // Пустое значение выключает мониторы стенда.
    stagingHost: value('KUMA_STAGING_HOST'),
    stagingNotifications: value('KUMA_STAGING_NOTIFICATIONS') === '1',
    discordWebhookUrl: value('KUMA_DISCORD_WEBHOOK_URL'),
    smtp: {
      host: value('KUMA_SMTP_HOST'),
      port: value('KUMA_SMTP_PORT') || '587',
      secure: value('KUMA_SMTP_SECURE') === 'true',
      username: value('KUMA_SMTP_USERNAME'),
      password: value('KUMA_SMTP_PASSWORD'),
      from: value('KUMA_SMTP_FROM'),
      to: value('KUMA_SMTP_TO'),
    },
  };
  for (const [key, name] of [
    ['productionHost', 'KUMA_PRODUCTION_HOST'],
    ['stagingHost', 'KUMA_STAGING_HOST'],
  ]) {
    if (config[key] && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(config[key])) {
      throw new Error(`${name}: ожидается имя хоста без схемы, пути и порта`);
    }
  }
  if (!config.password) {
    throw new Error('KUMA_PASSWORD: укажите пароль администратора Kuma');
  }
  if (!/^(wss?|https?):\/\/\S+$/i.test(config.url)) {
    throw new Error('KUMA_URL: ожидается адрес вида ws://uptime-kuma:3001 или wss://host');
  }
  if (config.discordWebhookUrl && !/^https:\/\/\S+$/.test(config.discordWebhookUrl)) {
    throw new Error('KUMA_DISCORD_WEBHOOK_URL: ожидается https-адрес вебхука');
  }
  if (!/^\d{1,5}$/.test(config.smtp.port)) {
    throw new Error('KUMA_SMTP_PORT: ожидается номер порта');
  }
  return config;
}

/**
 * Мониторы одного стенда: здоровье API, страница входа и рукопожатие WebSocket.
 * @param {'production' | 'staging'} target
 * @param {string} host
 * @param {boolean} notify
 * @returns {object[]}
 */
function siteMonitors(target, host, notify) {
  const name = PREFIX[target];
  return [
    {
      name: `${name}API — здоровье`,
      description: `https://${host}/api/health: status ok и база доступна`,
      type: 'json-query',
      url: `https://${host}/api/health`,
      // JSONata: оба поля одним значением, поэтому ответ без базы тоже замечается.
      jsonPath: 'status & " " & db',
      jsonPathOperator: '==',
      expectedValue: 'ok up',
      // Сертификат здесь тот же, что у сайта и WebSocket: предупреждения на 21, 14 и 7 дней.
      expiryNotification: true,
      notify,
    },
    {
      name: `${name}сайт — страница входа`,
      description: `https://${host}/ открывается`,
      type: 'http',
      url: `https://${host}/`,
      notify,
    },
    {
      name: `${name}WebSocket (аукцион)`,
      description: `wss://${host}/api/socket.io — рукопожатие проходит`,
      type: 'websocket-upgrade',
      url: `wss://${host}/api/socket.io/?EIO=4&transport=websocket`,
      // Kuma сама закрывает соединение кодом 1000 сразу после успешного апгрейда.
      accepted_statuscodes: ['1000'],
      notify,
    },
  ];
}

/** Имена всех мониторов, которые сценарий когда-либо создаёт. */
const OWNED_MONITOR_NAMES = Object.freeze(
  ['production', 'staging'].flatMap((target) =>
    siteMonitors(target, 'unused.invalid', false).map((monitor) => monitor.name),
  ),
);

/**
 * @param {object} config
 * @returns {object[]}
 */
export function buildMonitors(config) {
  return [
    ...siteMonitors('production', config.productionHost, true),
    ...(config.stagingHost
      ? siteMonitors('staging', config.stagingHost, config.stagingNotifications)
      : []),
  ];
}

/**
 * @param {object} config
 * @returns {object[]} определения уведомлений; пусто, если канал не задан
 */
export function buildNotifications(config) {
  const list = [];
  if (config.discordWebhookUrl) {
    list.push({
      name: NOTIFICATIONS.discord,
      type: 'discord',
      discordWebhookUrl: config.discordWebhookUrl,
      discordUsername: 'Мониторинг сайта',
    });
  }
  const { host, port, secure, username, password, from, to } = config.smtp;
  if (host) {
    if (!to) throw new Error('KUMA_SMTP_TO: укажите получателей почтовых оповещений');
    if (!from && !username) {
      throw new Error('KUMA_SMTP_FROM: укажите отправителя, если SMTP без логина');
    }
    list.push({
      name: NOTIFICATIONS.smtp,
      type: 'smtp',
      smtpHost: host,
      smtpPort: Number(port),
      smtpSecure: secure,
      smtpUsername: username,
      smtpPassword: password,
      smtpFrom: from || username,
      smtpTo: to,
    });
  }
  return list;
}

/**
 * Объект монитора в формате, который принимает Kuma.
 * @param {object} definition
 * @param {string[]} notificationIds
 * @param {object} [policy]
 */
export function monitorPayload(definition, notificationIds, policy = POLICY) {
  return {
    ...structuredClone(MONITOR_TEMPLATE),
    type: definition.type,
    name: definition.name,
    description: definition.description,
    url: definition.url,
    active: true,
    interval: policy.interval,
    retryInterval: policy.retryInterval,
    maxretries: policy.retries,
    resendInterval: policy.resendInterval,
    timeout: policy.timeout,
    expiryNotification: Boolean(definition.expiryNotification),
    // У домена .ru нет RDAP: Kuma не узнает срок регистрации и писал бы об этом в журнал.
    domainExpiryNotification: false,
    accepted_statuscodes: definition.accepted_statuscodes ?? ['200-299'],
    jsonPath: definition.jsonPath ?? null,
    jsonPathOperator: definition.jsonPathOperator ?? null,
    expectedValue: definition.expectedValue ?? null,
    notificationIDList: Object.fromEntries(notificationIds.map((id) => [String(id), true])),
  };
}

function sameValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const keys = Object.keys(left).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(right).sort())) return false;
  return keys.every((key) => left[key] === right[key]);
}

/**
 * Поля, в которых текущий монитор отличается от желаемого.
 * @param {object} current
 * @param {object} desired
 * @param {string[]} [skip] поля, которые сейчас сравнивать нельзя
 * @returns {string[]}
 */
export function changedFields(current, desired, skip = []) {
  return MONITOR_FIELDS.filter(
    (key) => !skip.includes(key) && !sameValue(current[key], desired[key]),
  );
}

// ---------------------------------------------------------------------------
// Socket.IO поверх WebSocket
// ---------------------------------------------------------------------------

/**
 * Адрес Engine.IO 4 по адресу панели.
 * @param {string} base
 * @returns {string}
 */
export function socketUrl(base) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (!url.pathname.includes('/socket.io')) {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/socket.io/`;
  }
  url.search = 'EIO=4&transport=websocket';
  return url.toString();
}

/**
 * Кадр Socket.IO из текста WebSocket.
 * @param {string} text
 * @returns {object}
 */
export function parseFrame(text) {
  if (text[0] === '0') return { kind: 'open' };
  if (text[0] === '2') return { kind: 'ping' };
  if (text[0] === '3') return { kind: 'pong' };
  if (text[0] !== '4') return { kind: 'other', text };
  let body = text.slice(2);
  if (text[1] === '0') return { kind: 'connect' };
  if (text[1] === '1') return { kind: 'disconnect' };
  if (text[1] === '4') return { kind: 'connect_error', data: JSON.parse(body) };
  if (text[1] !== '2' && text[1] !== '3') return { kind: 'other', text };
  // Формат события: «42», затем пространство имён с запятой (если не корневое),
  // затем номер подтверждения, затем JSON.
  const namespace = /^([^,[\d]+),/.exec(body);
  if (namespace) body = body.slice(namespace[0].length);
  const id = /^\d+/.exec(body);
  if (id) body = body.slice(id[0].length);
  const data = JSON.parse(body);
  return text[1] === '3'
    ? { kind: 'ack', id: id ? Number(id[0]) : null, args: data }
    : {
        kind: 'event',
        id: id ? Number(id[0]) : null,
        event: data[0],
        args: data.slice(1),
      };
}

/**
 * Кадр события с номером подтверждения.
 * @param {number} id
 * @param {string} event
 * @param {unknown[]} args
 * @returns {string}
 */
export function encodeEvent(id, event, args) {
  return `42${id}${JSON.stringify([event, ...args])}`;
}

class KumaClient {
  /**
   * @param {WebSocket} socket
   * @param {{ verbose?: (line: string) => void }} [options]
   */
  constructor(socket, { verbose } = {}) {
    this.socket = socket;
    this.state = { info: null, monitors: {}, notifications: [], heartbeats: {} };
    this.listeners = new Map();
    this.pending = new Map();
    this.nextAckId = 0;
    this.failure = null;
    // Диагностика (--verbose): только вид кадра, событие и номер — без аргументов,
    // среди которых бывают пароль и адрес вебхука.
    this.trace = verbose ?? (() => {});
    // Готовность — событие info, а не подтверждение пространства имён: Kuma
    // регистрирует обработчики событий после await sendInfo, и запрос, отправленный
    // сразу после «40», попадает в окно, где его некому принять, и теряется.
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    socket.addEventListener('message', (event) => this.#receive(String(event.data)));
    socket.addEventListener('close', () =>
      this.#fail(new Error('Соединение с Kuma закрылось до ответа')),
    );
    socket.addEventListener('error', () =>
      this.#fail(new Error('Не удалось соединиться с Kuma по WebSocket')),
    );
  }

  /** @returns {Promise<void>} Kuma приняла подключение и готова принимать события */
  ready() {
    return this.readyPromise;
  }

  /**
   * @param {string} event
   * @param {(...args: any[]) => void} listener
   * @returns {() => void} отписка
   */
  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  /**
   * Отправляет событие и ждёт подтверждения: первый аргумент ответа.
   * @param {string} event
   * @param {unknown[]} args
   * @returns {Promise<any>}
   */
  emit(event, ...args) {
    const id = this.nextAckId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Kuma не ответила на запрос «${event}» за 30 секунд`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.trace(`→ ${event} #${id}`);
      this.socket.send(encodeEvent(id, event, args));
    });
  }

  close() {
    this.#fail(new Error('Соединение закрыто'));
    this.socket.close();
  }

  /** @param {Error} error */
  #fail(error) {
    this.trace(`× ${error.message}`);
    this.rejectReady(error);
    if (this.failure) return;
    this.failure = error;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  /** @param {string} text */
  #receive(text) {
    let frame;
    try {
      frame = parseFrame(text);
    } catch {
      this.trace(`← ${JSON.stringify(text.slice(0, 40))}: не разобрано`);
      return;
    }
    const tag = `${frame.kind}${frame.event ? ` ${frame.event}` : ''}${
      frame.id != null ? ` #${frame.id}` : ''
    }`;
    if (frame.kind === 'open') {
      this.trace('← open; → namespace connect');
      this.socket.send('40');
      return;
    }
    this.trace(`← ${tag}`);
    if (frame.kind === 'ping') {
      this.socket.send('3');
      return;
    }
    if (frame.kind === 'ack') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      pending.resolve(frame.args[0]);
      return;
    }
    if (frame.kind === 'connect_error') {
      this.#fail(new Error('Kuma отклонила подключение Socket.IO'));
      return;
    }
    if (frame.kind !== 'event') return;
    this.#remember(frame);
    if (frame.event === 'info') this.resolveReady();
    for (const listener of this.listeners.get(frame.event) ?? []) listener(...frame.args);
  }

  /** @param {{ event: string, args: any[] }} frame */
  #remember(frame) {
    const [first, second] = frame.args;
    if (frame.event === 'info') this.state.info = first;
    else if (frame.event === 'monitorList') this.state.monitors = first;
    else if (frame.event === 'notificationList') this.state.notifications = first;
    else if (frame.event === 'heartbeatList') this.state.heartbeats[first] = second;
    else if (frame.event === 'heartbeat') {
      (this.state.heartbeats[first.monitorID] ??= []).push(first);
    }
  }
}

/**
 * @param {string} url
 * @param {{ WebSocketImpl?: any, timeoutMs?: number, verbose?: (line: string) => void }} [options]
 * @returns {Promise<KumaClient>}
 */
export function connect(
  url,
  { WebSocketImpl = globalThis.WebSocket, timeoutMs = 30_000, verbose } = {},
) {
  if (!WebSocketImpl) {
    return Promise.reject(new Error('Нужен Node.js 22 или новее со встроенным WebSocket'));
  }
  const target = new URL(socketUrl(url));
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(target, {
      // Kuma сверяет Origin с Host; без заголовка соединение тоже допускается.
      headers: { Origin: `http://${target.host}` },
    });
    const client = new KumaClient(socket, { verbose });
    let finished = false;
    // Отказ сокета до готовности не должен ждать таймаута; поздние события уже ничего не решают.
    const settle = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) {
        socket.close();
        reject(error);
      } else {
        resolve(client);
      }
    };
    const timer = setTimeout(
      () => settle(new Error(`Kuma недоступна по адресу ${url}`)),
      timeoutMs,
    );
    socket.addEventListener('close', () =>
      settle(new Error(`Соединение с Kuma по адресу ${url} закрылось до готовности`)),
    );
    socket.addEventListener('error', () =>
      settle(new Error(`Не удалось соединиться с Kuma по адресу ${url}`)),
    );
    client.ready().then(
      () => settle(null),
      (error) =>
        settle(
          error.message === 'Kuma отклонила подключение Socket.IO'
            ? new Error(`${error.message} по адресу ${url}`)
            : error,
        ),
    );
  });
}

// ---------------------------------------------------------------------------
// Действия
// ---------------------------------------------------------------------------

async function checked(response, title) {
  if (!response || response.ok !== true) {
    throw new Error(`${title}: Kuma ответила «${response?.msg ?? 'без ответа'}»`);
  }
  return response;
}

/**
 * Входит в Kuma; при первом запуске (и разрешении) создаёт администратора.
 * @param {KumaClient} client
 * @param {object} config
 * @param {{ allowSetup: boolean, dryRun: boolean }} options
 * @returns {Promise<'created' | 'existing' | 'planned'>}
 */
async function signIn(client, config, { allowSetup, dryRun }) {
  const needSetup = (await client.emit('needSetup')) === true;
  if (needSetup && !allowSetup) {
    throw new Error('Kuma ещё не настроена: сначала запустите apply');
  }
  if (needSetup) {
    if (dryRun) return 'planned';
    await checked(
      await client.emit('setup', config.username, config.password),
      'Создание администратора',
    );
  }
  const login = await client.emit('login', {
    username: config.username,
    password: config.password,
  });
  if (login.tokenRequired) {
    throw new Error('У учётной записи включена двухфакторная защита: сценарий на неё не рассчитан');
  }
  await checked(login, 'Вход в Kuma');
  // Список мониторов приходит событием до подтверждения — состояние после этого свежее.
  await checked(await client.emit('getMonitorList'), 'Список мониторов');
  return needSetup ? 'created' : 'existing';
}

/** Содержимое сохранённого уведомления совпадает с определением (имя не в счёт). */
function notificationMatches(existing, definition) {
  let stored;
  try {
    stored = JSON.parse(existing.config ?? '{}');
  } catch {
    return false;
  }
  return Object.keys(definition).every((key) => stored[key] === definition[key]);
}

/**
 * Приводит Kuma в соответствие окружению.
 * @param {KumaClient} client
 * @param {object} config
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<object>} отчёт
 */
export async function apply(client, config, { dryRun = false } = {}) {
  const report = {
    dryRun,
    setup: 'existing',
    silent: false,
    notifications: { created: [], updated: [], unchanged: [], deleted: [] },
    monitors: { created: [], updated: [], unchanged: [], deleted: [] },
  };
  report.setup = await signIn(client, config, { allowSetup: true, dryRun });
  if (report.setup === 'planned') return report;

  // Идентификаторы новых уведомлений в режиме плана неизвестны (null).
  const definitions = buildNotifications(config);
  const notificationIds = [];
  for (const definition of definitions) {
    const existing = client.state.notifications.find((item) => item.name === definition.name);
    const matches = existing && notificationMatches(existing, definition);
    if (matches) {
      notificationIds.push(String(existing.id));
      report.notifications.unchanged.push(definition.name);
      continue;
    }
    if (dryRun) {
      notificationIds.push(null);
      report.notifications[existing ? 'updated' : 'created'].push(definition.name);
      continue;
    }
    const saved = await checked(
      await client.emit('addNotification', definition, existing?.id ?? null),
      `Уведомление «${definition.name}»`,
    );
    notificationIds.push(String(saved.id));
    report.notifications[existing ? 'updated' : 'created'].push(definition.name);
  }
  // Канал, который убрали из окружения, не должен оставаться в панели.
  const wanted = new Set(definitions.map((definition) => definition.name));
  for (const existing of client.state.notifications) {
    if (!OWNED_NOTIFICATION_NAMES.includes(existing.name) || wanted.has(existing.name)) {
      continue;
    }
    if (!dryRun) {
      await checked(
        await client.emit('deleteNotification', existing.id),
        `Удаление уведомления «${existing.name}»`,
      );
    }
    report.notifications.deleted.push(existing.name);
  }
  report.silent = notificationIds.length === 0;
  // В плане привязку мониторов не сверяем: идентификатор только что спланированного
  // уведомления неизвестен, а удаляемый канал ещё держит привязку — Kuma снимет её каскадом.
  const bindingPending = notificationIds.includes(null) || report.notifications.deleted.length > 0;
  const skip = dryRun && bindingPending ? ['notificationIDList'] : [];

  const owned = new Map(
    Object.values(client.state.monitors)
      .filter((monitor) => OWNED_MONITOR_NAMES.includes(monitor.name))
      .map((monitor) => [monitor.name, monitor]),
  );
  for (const definition of buildMonitors(config)) {
    const payload = monitorPayload(definition, definition.notify ? notificationIds : []);
    const listed = owned.get(definition.name);
    owned.delete(definition.name);
    if (!listed) {
      if (!dryRun) await checked(await client.emit('add', payload), `Монитор «${definition.name}»`);
      report.monitors.created.push(definition.name);
      continue;
    }
    const current = (
      await checked(await client.emit('getMonitor', listed.id), `Монитор «${definition.name}»`)
    ).monitor;
    const fields = changedFields(current, payload, skip);
    if (fields.length === 0) {
      report.monitors.unchanged.push(definition.name);
      continue;
    }
    if (!dryRun) {
      await checked(
        await client.emit('editMonitor', { ...current, ...payload }),
        `Монитор «${definition.name}»`,
      );
    }
    report.monitors.updated.push(`${definition.name} (${fields.join(', ')})`);
  }
  for (const [name, monitor] of owned) {
    if (!dryRun) {
      await checked(await client.emit('deleteMonitor', monitor.id, false), `Удаление «${name}»`);
    }
    report.monitors.deleted.push(name);
  }
  return report;
}

/**
 * Момент проверки в часовом поясе панели.
 * Kuma пишет время строкой UTC без зоны («2026-11-26 12:00:00.000»), а Date такую
 * строку читает как локальное время процесса — получалось на три часа раньше.
 * @param {string} value
 * @param {string | undefined} timeZone
 * @returns {string}
 */
export function formatTime(value, timeZone) {
  const text = String(value).trim().replace(' ', 'T');
  const zoned = /(?:Z|[+-]\d\d:?\d\d)$/i.test(text) ? text : `${text}Z`;
  const date = new Date(zoned);
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(Number.isNaN(date.getTime()) ? new Date(value) : date);
  } catch {
    return String(value);
  }
}

/**
 * Строки последних проверок мониторов сценария.
 * @param {KumaClient} client
 * @returns {string[]}
 */
export function statusLines(client) {
  const timeZone = client.state.info?.serverTimezone;
  return Object.values(client.state.monitors)
    .filter((monitor) => OWNED_MONITOR_NAMES.includes(monitor.name))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
    .map((monitor) => {
      if (monitor.active === false) return `${monitor.name}: PAUSED`;
      const last = (client.state.heartbeats[monitor.id] ?? []).at(-1);
      if (!last) return `${monitor.name}: проверок ещё не было`;
      const state = STATUS[last.status] ?? 'UNKNOWN';
      const time = formatTime(last.time, timeZone);
      const ping = last.ping == null ? '' : `${last.ping} мс`;
      const message = String(last.msg ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return `${monitor.name}: ${state}, ${time}, ${ping} ${message}`.trim();
    });
}

/**
 * @param {object} report
 * @returns {string}
 */
export function formatReport(report) {
  const { created, updated, unchanged, deleted } = report.notifications;
  const list = (names) => names.join(', ') || '—';
  const lines = [
    `Учётная запись: ${
      { planned: 'будет создана (сейчас только план)', created: 'создана', existing: 'уже есть' }[
        report.setup
      ]
    }`,
    `Уведомления: создано — ${list(created)}; обновлено — ${list(updated)}; удалено — ${list(deleted)}; без изменений — ${list(unchanged)}`,
  ];
  if (report.silent) {
    lines.push('Канал оповещений не задан: мониторы работают, но ничего не отправляют.');
  }
  for (const name of report.monitors.created) lines.push(`  + ${name}`);
  for (const name of report.monitors.updated) lines.push(`  ~ ${name}`);
  for (const name of report.monitors.unchanged) lines.push(`  = ${name}`);
  for (const name of report.monitors.deleted) lines.push(`  - ${name}`);
  const { monitors } = report;
  lines.push(
    `ИТОГ (${report.dryRun ? 'план, ничего не записано' : 'записано'}): создано ${monitors.created.length}, изменено ${monitors.updated.length}, удалено ${monitors.deleted.length}, без изменений ${monitors.unchanged.length}`,
  );
  return lines.join('\n');
}

function redact(text, config) {
  let result = String(text);
  for (const secret of [config.password, config.discordWebhookUrl, config.smtp.password]) {
    if (secret && secret.length >= 6) result = result.split(secret).join('***');
  }
  return result;
}

function watchSeconds(flags) {
  const index = flags.indexOf('--watch');
  if (index === -1) return 0;
  const seconds = Number(flags[index + 1]);
  return Number.isInteger(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 0;
}

/**
 * До первого запуска с UPTIME_KUMA_DB_TYPE Kuma 2 показывает мастер выбора базы
 * вместо панели и не отвечает на события; тогда объясняем причину, а не ждём таймаута.
 * @param {string} url
 * @param {Function} [fetchImpl]
 */
export async function assertKumaReady(url, fetchImpl = globalThis.fetch) {
  const base = new URL(url);
  base.protocol =
    base.protocol === 'wss:' ? 'https:' : base.protocol === 'ws:' ? 'http:' : base.protocol;
  base.pathname = '/setup-database-info';
  base.search = '';
  let info;
  try {
    info = await (await fetchImpl(base, { signal: AbortSignal.timeout(10_000) })).json();
  } catch {
    // Недоступность покажет подключение по WebSocket.
    return;
  }
  if (info?.needSetup === true) {
    throw new Error(
      'Kuma ждёт выбора базы данных в мастере /setup-database: задайте UPTIME_KUMA_DB_TYPE в docker-compose.monitoring.yml и перезапустите проект',
    );
  }
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ WebSocketImpl?: any, fetchImpl?: Function, stdout?: any, stderr?: any }} [options]
 * @returns {Promise<number>} код выхода
 */
export async function main(argv, env, options = {}) {
  const { WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch } = options;
  const out = options.stdout ?? process.stdout;
  const err = options.stderr ?? process.stderr;
  const [command = 'apply', ...flags] = argv;
  if (!COMMANDS.includes(command) || flags.includes('--help')) {
    err.write(
      'Использование: kuma-setup.mjs [apply|status|test-notification] [--dry-run] [--watch N]\n',
    );
    return 2;
  }
  let config;
  try {
    config = readConfig(env);
  } catch (error) {
    err.write(`ОШИБКА: ${error.message}\n`);
    return 2;
  }
  let client;
  try {
    await assertKumaReady(config.url, fetchImpl);
    client = await connect(config.url, {
      WebSocketImpl,
      verbose: flags.includes('--verbose') ? (line) => err.write(`${line}\n`) : undefined,
    });
    if (command === 'apply') {
      out.write(
        `${formatReport(await apply(client, config, { dryRun: flags.includes('--dry-run') }))}\n`,
      );
    } else if (command === 'status') {
      await signIn(client, config, { allowSetup: false, dryRun: false });
      const seconds = watchSeconds(flags);
      const live = new Map(
        Object.values(client.state.monitors)
          .filter((monitor) => OWNED_MONITOR_NAMES.includes(monitor.name))
          .map((monitor) => [monitor.id, monitor.name]),
      );
      out.write(`Kuma ${client.state.info?.version ?? '?'}\n${statusLines(client).join('\n')}\n`);
      if (seconds > 0) {
        const off = client.on('heartbeat', (beat) => {
          if (!live.has(beat.monitorID)) return;
          const mark = beat.important ? '!' : ' ';
          const message = String(beat.msg ?? '').slice(0, 160);
          out.write(
            `${formatTime(beat.time, client.state.info?.serverTimezone)} ${mark} ${STATUS[beat.status] ?? 'UNKNOWN'}  ${live.get(beat.monitorID)}: ${message}\n`,
          );
        });
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        off();
        out.write(`Состояние на конец наблюдения:\n${statusLines(client).join('\n')}\n`);
      }
    } else {
      await signIn(client, config, { allowSetup: false, dryRun: false });
      const definitions = buildNotifications(config);
      if (definitions.length === 0) {
        out.write('Канал оповещений не задан: отправлять нечего.\n');
      }
      for (const definition of definitions) {
        const result = await checked(
          await client.emit('testNotification', definition),
          `Канал «${definition.name}»`,
        );
        out.write(`«${definition.name}»: ${result.msg}\n`);
      }
    }
    return 0;
  } catch (error) {
    err.write(`ОШИБКА: ${redact(error.message, config)}\n`);
    return 1;
  } finally {
    client?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
