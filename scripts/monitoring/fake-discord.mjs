#!/usr/bin/env node
/**
 * Заглушка Discord для проверок ретранслятора оповещений — только в CI и
 * локальных прогонах, в работе проекта не участвует.
 *
 *   node scripts/monitoring/fake-discord.mjs [порт, по умолчанию 8099]
 *
 * Отвечает на два запроса, которые делает ретранслятор, и печатает каждое
 * личное сообщение строкой JSON в stdout — проверка читает её через docker logs.
 *   POST /users/@me/channels          → { id: "dm-<recipient_id>", type: 1 }
 *   POST /channels/dm-<id>/messages  → { id: "m-<n>" } и строка в журнале
 *   GET  /__messages                  — список полученных сообщений (для curl)
 * Остальное — 404.
 */

import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8099);
const messages = [];

createServer(async (request, response) => {
  const reply = (status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
  if (request.method === 'GET' && request.url === '/__messages') {
    return reply(200, messages);
  }
  let body = {};
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    return reply(400, { message: 'bad json' });
  }
  const authorized = request.headers.authorization?.startsWith('Bot ');
  if (!authorized) return reply(401, { message: '401: Unauthorized' });
  if (request.method === 'POST' && request.url === '/users/@me/channels') {
    return reply(200, { id: `dm-${body.recipient_id}`, type: 1 });
  }
  const message = /^\/channels\/(dm-\d+)\/messages$/.exec(request.url ?? '');
  if (request.method === 'POST' && message) {
    const record = { channel: message[1], content: body.content ?? null };
    messages.push(record);
    console.log(JSON.stringify(record));
    return reply(200, { id: `m-${messages.length}` });
  }
  return reply(404, { message: '404: Not Found' });
}).listen(port, () => {
  console.log(`fake-discord слушает порт ${port}`);
});
