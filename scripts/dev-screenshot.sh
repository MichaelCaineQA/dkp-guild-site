#!/usr/bin/env bash
# Скриншотный стенд одной командой (урок ретро #101, 2026-11-11).
#
#   scripts/dev-screenshot.sh up     — поднять web :3090 + API :3005
#   scripts/dev-screenshot.sh down   — остановить и откатить next.config.ts
#   scripts/dev-screenshot.sh status — порты и health-чек
#
# Что делает up:
#  - API :3005 на ТЕСТ-БД dkp_test (не dev!) с AUTH_TEST_MODE=true —
#    port 3001 обычно занят dev-API второй сессии;
#  - применяет миграции и сид test-юзеров к dkp_test;
#  - временно переключает прокси /api в apps/web/next.config.ts на :3005
#    (откатывается в down и по trap при прерывании);
#  - web (next dev) на :3090, логи в /tmp/dkp-shot-{api,web}.log.
#
# Вход под игроком (курсором/браузером — cookie dkp.sid):
#   POST /auth/test-login {"username":"test-member"}   затем GET /auth/me
#   (без /me сессия без Member/прав; юзеры: test-leader/…member/…member2).
# Резервный админ: POST /auth/admin/login из apps/api/.env.
# Кириллицу в тела запросов — файлом + curl --data-binary @file.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_CONFIG="$ROOT/apps/web/next.config.ts"
FLAG="$ROOT/.dev-screenshot.active"
TEST_DB="postgresql://dkp:dkp@127.0.0.1:5432/dkp_test?schema=public"
API_PORT=3005
WEB_PORT=3090

log() { printf '[dev-screenshot] %s\n' "$*"; }

port_pids() { # $1 = port → PID слушателя (может быть пусто)
  netstat -ano | grep -E ":$1[[:space:]].*LISTENING" | awk '{print $5}' | sort -u
}

kill_port() { # $1 = port — тихо убивает слушателей
  local pid
  for pid in $(port_pids "$1"); do taskkill //PID "$pid" //F >/dev/null 2>&1 || true; done
}

restore_config() {
  if [ -f "$FLAG" ]; then
    node -e "
const fs = require('fs');
const p = process.argv[1];
let s = fs.readFileSync(p, 'utf8');
s = s.replace('localhost:$API_PORT', 'localhost:3001');
fs.writeFileSync(p, s);
" "$WEB_CONFIG" && rm -f "$FLAG" && log "next.config.ts откатан на :3001"
  fi
}

case "${1:-}" in
up)
  if [ -n "$(port_pids "$API_PORT")$(port_pids "$WEB_PORT")" ]; then
    log "ПОРТ $API_PORT/$WEB_PORT ЗАНЯТ — сначала down или освободите порты:"
    port_pids "$API_PORT"; port_pids "$WEB_PORT"; exit 1
  fi
  trap restore_config INT TERM

  # 0. БД должна быть доступна (docker compose db), иначе миграции падают P1001.
  if ! (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
    log "PostgreSQL :5432 недоступен — сначала «docker compose up -d» (db+redis)"
    exit 1
  fi

  # 1. Миграции и сид test-юзеров на dkp_test (generate пропускаем — EPERM на Windows при живом node).
  (cd "$ROOT/apps/api" \
    && DATABASE_URL="$TEST_DB" npx prisma migrate deploy >/dev/null \
    && DATABASE_URL="$TEST_DB" npx ts-node prisma/seed-test.ts >/dev/null)
  log "dkp_test: миграции и test-юзеры готовы"

  # 2. Временный прокси web → :3005 (только если ещё не переключали).
  if ! grep -q "localhost:$API_PORT" "$WEB_CONFIG"; then
    node -e "
const fs = require('fs');
const p = process.argv[1];
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('localhost:3001')) { console.error('в next.config.ts нет :3001 — проверьте вручную'); process.exit(1); }
s = s.replace('localhost:3001', 'localhost:$API_PORT');
fs.writeFileSync(p, s);
" "$WEB_CONFIG" && touch "$FLAG" && log "прокси /api → :$API_PORT (временная правка)"
  fi

  # 3. API на тест-БД.
  (cd "$ROOT/apps/api" \
    && PORT=$API_PORT AUTH_TEST_MODE=true WEB_URL=http://localhost:$WEB_PORT \
      DATABASE_URL="$TEST_DB" nohup pnpm dev > /tmp/dkp-shot-api.log 2>&1 &)
  # 4. web.
  (cd "$ROOT/apps/web" && nohup npx next dev -p $WEB_PORT > /tmp/dkp-shot-web.log 2>&1 &)

  for i in $(seq 1 45); do
    sleep 2
    api=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/health" || true)
    web=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" || true)
    if [ "$api" = 200 ] && [ "$web" = 200 ]; then
      log "ГОТОВО: web http://127.0.0.1:$WEB_PORT  API :$API_PORT (dkp_test)"
      log "логи: /tmp/dkp-shot-{api,web}.log; уборка: $0 down"
      exit 0
    fi
  done
  log "не дождались стека за 90с — смотри логи /tmp/dkp-shot-*.log (down для уборки)"
  exit 1
  ;;
down)
  kill_port "$WEB_PORT"; kill_port "$API_PORT"
  restore_config
  log "стенд остановлен"
  ;;
status)
  for p in "$API_PORT" "$WEB_PORT"; do
    if [ -n "$(port_pids "$p")" ]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/health" \
        || curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/" || true)
      log ":$p занят (LISTEN), HTTP $code"
    else
      log ":$p свободен"
    fi
  done
  ;;
*)
  echo "usage: $0 up|down|status" >&2; exit 2 ;;
esac
