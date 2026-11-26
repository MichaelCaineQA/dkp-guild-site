// Юнит-тесты внешнего пробника (node --test):
//   node --test scripts/monitoring/external-probe.test.mjs
// Globalping заменена сценарием ответов.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  evaluateMeasurement,
  evaluateProbe,
  main,
  readConfig,
  stepSummary,
} from './external-probe.mjs';

const API = 'https://globalping.test/v1';

/**
 * Сценарий Globalping: ответы выдаются по очереди — создание измерения,
 * затем опросы (по умолчанию один на попытку).
 */
function globalping(steps) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const step = steps.shift() ?? {};
    if (init.method === 'POST') {
      return new Response(JSON.stringify({ id: step.id ?? 'm1', probesCount: 2 }), {
        status: step.status ?? 202,
      });
    }
    return new Response(JSON.stringify(step.measurement ?? { status: 'in-progress' }), {
      status: step.status ?? 200,
    });
  };
  return { impl, calls };
}

const OK = (country, city = country === 'RU' ? 'Moscow' : 'Riga') => ({
  probe: { country, city, network: `Net-${country}` },
  result: {
    status: 'finished',
    statusCode: 200,
    rawBody: '{"status":"ok","db":"up"}',
    timings: { total: 120 },
  },
});
const FAIL = (country, result = { status: 'finished', statusCode: 0 }) => ({
  probe: { country, city: 'Nowhere', network: 'Net' },
  result,
});
const finished = (...results) => ({ status: 'finished', results });
const bothFine = () => [{}, { measurement: finished(OK('RU'), OK('LV')) }];

async function run(steps, env = {}, options = {}) {
  const api = globalping(steps);
  const out = [];
  const errors = [];
  const pauses = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dkp-probe-'));
  const summaryPath = path.join(dir, 'summary.md');
  const code = await main(
    { GLOBALPING_API: API, PROBE_ATTEMPTS: '2', PROBE_ATTEMPT_DELAY: '500', ...env },
    {
      fetchImpl: api.impl,
      stdout: { write: (chunk) => out.push(chunk) },
      stderr: { write: (chunk) => errors.push(chunk) },
      pause: async (ms) => {
        pauses.push(ms);
      },
      summaryPath,
      ...options,
    },
  );
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, out: out.join(''), errors: errors.join(''), pauses, calls: api.calls, summary };
}

test('readConfig: значения по умолчанию и проверка переменных', () => {
  const config = readConfig({});
  assert.equal(config.target, 'suneclipse.ru');
  assert.deepEqual(config.countries, ['RU', 'LV']);
  assert.equal(config.attempts, 3);
  assert.equal(config.attemptDelayMs, 20_000);
  assert.equal(config.api, 'https://api.globalping.io/v1');
  assert.deepEqual(readConfig({ PROBE_COUNTRIES: ' ru , lv ,' }).countries, ['RU', 'LV']);
  // Пустое значение — это тоже умолчание, а не ошибка.
  assert.deepEqual(readConfig({ PROBE_COUNTRIES: '' }).countries, ['RU', 'LV']);
  assert.throws(() => readConfig({ PROBE_TARGET: 'https://suneclipse.ru/' }), /PROBE_TARGET/);
  assert.throws(() => readConfig({ PROBE_COUNTRIES: 'Russia' }), /PROBE_COUNTRIES/);
  assert.throws(() => readConfig({ PROBE_COUNTRIES: ' , ' }), /PROBE_COUNTRIES/);
  assert.throws(() => readConfig({ PROBE_ATTEMPTS: '0' }), /PROBE_ATTEMPTS/);
  assert.throws(() => readConfig({ PROBE_ATTEMPT_DELAY: 'soon' }), /PROBE_ATTEMPT_DELAY/);
});

test('evaluateProbe: доступен только ответ 200 с status ok и db up', () => {
  assert.deepEqual(evaluateProbe(OK('RU')), {
    country: 'RU',
    city: 'Moscow',
    network: 'Net-RU',
    ok: true,
    detail: '120 мс',
  });
  assert.equal(evaluateProbe(FAIL('RU', { status: 'failed' })).ok, false);
  assert.match(
    evaluateProbe(FAIL('RU', { status: 'failed' })).detail,
    /зонд не завершил проверку \(ошибка\)/,
  );
  assert.equal(
    evaluateProbe(FAIL('RU', { status: 'in-progress' })).detail,
    'зонд не завершил проверку (in-progress)',
  );
  assert.equal(evaluateProbe(FAIL('RU')).detail, 'HTTP 0');
  assert.equal(
    evaluateProbe(FAIL('RU', { status: 'finished', statusCode: 503 })).detail,
    'HTTP 503',
  );
  assert.equal(
    evaluateProbe(
      FAIL('RU', { status: 'finished', statusCode: 200, rawBody: '{"status":"ok","db":"down"}' }),
    ).detail,
    'сайт ответил, но health это не подтверждает',
  );
  assert.equal(
    evaluateProbe(FAIL('RU', { status: 'finished', statusCode: 200, rawBody: '<html>' })).ok,
    false,
  );
  assert.equal(evaluateProbe(undefined).ok, false);
});

test('evaluateMeasurement: каждая страна должна быть подтверждена', () => {
  assert.equal(evaluateMeasurement(finished(OK('RU'), OK('LV')), ['RU', 'LV']).ok, true);
  const missing = evaluateMeasurement(finished(OK('RU'), FAIL('LV')), ['RU', 'LV']);
  assert.equal(missing.ok, false);
  assert.equal(missing.problem, 'нет подтверждения из LV');
  assert.equal(missing.probes.length, 2);
  const failed = evaluateMeasurement({ status: 'failed', results: [] }, ['RU', 'LV']);
  assert.equal(failed.ok, false);
  assert.equal(failed.problem, 'Globalping не смог выполнить измерение');
  assert.equal(
    evaluateMeasurement({ status: 'finished', results: [] }, ['RU', 'LV']).problem,
    'нет подтверждения из RU, LV',
  );
  // Лишний неудачный зонд при покрытых странах — тоже тревога.
  const extra = evaluateMeasurement(finished(OK('RU'), OK('RU'), OK('LV')), ['RU', 'LV']);
  assert.equal(extra.ok, true);
  const extraFail = evaluateMeasurement(finished(OK('RU'), FAIL('RU'), OK('LV')), ['RU', 'LV']);
  assert.equal(extraFail.ok, false);
  assert.equal(extraFail.problem, 'есть неудачные зонды');
});

test('stepSummary: таблица зондов, трубы и переводы строк экранируются', () => {
  const summary = stepSummary({
    target: 'suneclipse.ru',
    attempt: 3,
    probes: [
      { country: 'RU', city: 'Moscow|north', network: 'Line\n1', ok: false, detail: 'HTTP 0' },
    ],
    problem: 'нет подтверждения из RU, LV',
    verdict: 'Сайт недоступен',
  });
  assert.match(summary, /^# Доступность suneclipse\.ru$/m);
  assert.match(summary, /\*\*Сайт недоступен\*\* — нет подтверждения из RU, LV \(попыток: 3\)/);
  assert.ok(summary.includes('| RU | Moscow\\|north | Line 1 | ❌ недоступен | HTTP 0 |'));
  const empty = stepSummary({
    target: 'x.ru',
    attempt: 1,
    probes: [],
    problem: 'зондов нет',
    verdict: 'Проверить не удалось',
  });
  assert.ok(empty.includes('| — | — | — | ❌ недоступен | зондов нет |'));
});

test('main: сайт виден из обеих стран — успех с первой попытки', async () => {
  const result = await run(bothFine());
  assert.equal(result.code, 0);
  assert.equal(result.errors, '');
  assert.equal(result.summary, '');
  assert.match(result.out, /^OK RU \(Moscow, Net-RU\): 120 мс\nOK LV \(Riga, Net-LV\): 120 мс\n$/);
  assert.deepEqual(result.pauses, []);
  const create = result.calls[0];
  assert.equal(create.method, 'POST');
  assert.equal(create.url, `${API}/measurements`);
  assert.deepEqual(create.body, {
    type: 'http',
    target: 'suneclipse.ru',
    locations: [{ country: 'RU' }, { country: 'LV' }],
    limit: 2,
    measurementOptions: {
      protocol: 'HTTPS',
      port: 443,
      request: { method: 'GET', path: '/api/health', host: 'suneclipse.ru' },
    },
  });
  assert.equal(result.calls[1].url, `${API}/measurements/m1`);
});

test('main: разовый сбой зонда не тревожит — вторая попытка после паузы', async () => {
  const result = await run([
    {},
    { measurement: finished(OK('RU'), FAIL('LV', { status: 'failed' })) },
    ...bothFine(),
  ]);
  assert.equal(result.code, 0);
  assert.deepEqual(result.pauses, [500]);
  // В неудачной попытке перечислены все зонды — видно, кто видит сайт, а кто нет.
  assert.match(
    result.out,
    /^ПОПЫТКА 1: нет подтверждения из LV\n {2}RU \(Moscow, Net-RU\): 120 мс\n {2}LV \(Nowhere, Net\): зонд не завершил проверку \(ошибка\)\nOK RU \(Moscow, Net-RU\): 120 мс\nOK LV \(Riga, Net-LV\): 120 мс\n$/,
  );
  assert.equal(result.summary, '');
});

test('main: измерение сначала идёт, потом завершается', async () => {
  const result = await run([
    {},
    { measurement: { status: 'in-progress' } },
    ...bothFine().slice(1),
  ]);
  assert.equal(result.code, 0);
  assert.deepEqual(result.pauses, [1000]);
  assert.equal(result.calls.filter((call) => call.method === 'POST').length, 1);
});

test('main: устойчивая недоступность — код 1, сводка и сообщение об аварии', async () => {
  const result = await run([
    {},
    { measurement: finished(FAIL('RU', { status: 'finished', statusCode: 525 })) },
    {},
    { measurement: finished(OK('RU'), FAIL('LV', { status: 'failed' })) },
  ]);
  assert.equal(result.code, 1);
  assert.deepEqual(result.pauses, [500]);
  assert.equal(result.calls.filter((call) => call.method === 'POST').length, 2);
  assert.match(
    result.errors,
    /^АВАРИЯ: suneclipse\.ru — нет подтверждения из LV после 2 попыток\n$/,
  );
  assert.match(
    result.summary,
    /\*\*Сайт недоступен или проверить не удалось\*\* — нет подтверждения из LV \(попыток: 2\)/,
  );
  assert.ok(
    result.summary.includes(
      '| LV | Nowhere | Net | ❌ недоступен | зонд не завершил проверку (ошибка) |',
    ),
  );
});

test('main: Globalping API недоступна — код 1 с названием причины', async () => {
  const rejected = await run([{ status: 429 }, { status: 429 }]);
  assert.equal(rejected.code, 1);
  assert.match(rejected.errors, /Globalping API не приняла запрос \(HTTP 429\) после 2 попыток/);
  assert.ok(rejected.summary.includes('| — | — | — | ❌ недоступен | зондов нет |'));
  const noResult = await run([{}, { status: 500 }, {}, { status: 500 }]);
  assert.equal(noResult.code, 1);
  assert.match(noResult.errors, /Globalping API не отдала результат \(HTTP 500\)/);
  const network = await run([{}, ...Array(31).fill({ measurement: { status: 'in-progress' } })], {
    PROBE_ATTEMPTS: '1',
  });
  assert.equal(network.code, 1);
  assert.match(network.errors, /не завершила измерение за 30 секунд/);
  assert.deepEqual(network.pauses, Array(30).fill(1000));
});

test('main: неверные настройки — код 2 без запросов', async () => {
  const result = await run([], { PROBE_TARGET: 'bad host' });
  assert.equal(result.code, 2);
  assert.match(result.errors, /PROBE_TARGET/);
  assert.equal(result.calls.length, 0);
});
