#!/usr/bin/env bash
# Скриншотный стенд одной командой (урок ретро #101, 2026-11-11).
#
#   scripts/dev-screenshot.sh up     — поднять web :3090 + API :3005
#   scripts/dev-screenshot.sh down   — остановить стенд целиком и откатить next.config.ts
#   scripts/dev-screenshot.sh status — порты, health и кто их держит
#
# Что делает up:
#  - API :3005 на ТЕСТ-БД dkp_test (не dev!) с AUTH_TEST_MODE=true —
#    port 3001 обычно занят dev-API второй сессии;
#  - применяет миграции и сид test-юзеров к dkp_test;
#  - временно переключает прокси /api в apps/web/next.config.ts на :3005
#    (откатывается в down; прерванный up сам останавливает уже запущенные
#    серверы и откатывает прокси);
#  - web (next dev) на :3090, логи в /tmp/dkp-shot-{api,web}.log;
#  - запоминает в .dev-screenshot.active пускачей серверов, чтобы down снял их
#    деревья целиком.
#
# Вход под игроком (курсором/браузером — cookie dkp.sid):
#   POST /auth/test-login {"username":"test-member"}   затем GET /auth/me
#   (без /me сессия без Member/прав; юзеры: test-leader/…member/…member2).
# Резервный админ: POST /auth/admin/login из apps/api/.env.
# Кириллицу в тела запросов — файлом + curl --data-binary @file.
#
# Уборка (#296). Порт API слушает дочерний процесс `nest start --watch`;
# убийство одного слушателя оставляло watcher живым, он перезапускал API на
# :3005, и следующий up падал «ПОРТ ЗАНЯТ». Поэтому down снимает деревья:
# по записанным пускачам и по корню цепочки слушателя. Чужие — стенд из другого
# каталога (вторая сессия в другом клоне) — не трогает и сообщает о них.
# Слушатель без записей и без признаков этого каталога (осиротевший watcher
# прошлых запусков) down находит, только пока он слушает порт; иначе его
# показывает status.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_CONFIG="$ROOT/apps/web/next.config.ts"
FLAG="$ROOT/.dev-screenshot.active"
TREE_PS1="$ROOT/scripts/dev-screenshot-procs.ps1"
TEST_DB="postgresql://dkp:dkp@127.0.0.1:5432/dkp_test?schema=public"
API_PORT=3005
WEB_PORT=3090

log() { printf '[dev-screenshot] %s\n' "$*"; }

win_path() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }

port_pids() { # $1 = port → PID слушателей (может быть пусто)
  netstat -ano | grep -E ":$1[[:space:]].*LISTENING" | awk '{print $5}' | sort -u
}

winpid_of() { # $1 = PID в MSYS → текущий Windows PID того же процесса
  cat "/proc/$1/winpid" 2>/dev/null || true
}

alive() { # $1 = Windows PID → код 0, если процесс ещё есть
  tasklist //FI "PID eq $1" 2>/dev/null | tr -d '\r' |
    awk -v pid="$1" '$2 == pid { found = 1 } END { exit found ? 0 : 1 }'
}

kill_tree() { # $1 = Windows PID — процесс и все его потомки; успех — процесса больше нет
  local pid="$1" _
  for _ in 1 2 3; do
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
    # taskkill /T отвечает ошибкой, когда корень завершается сам, едва погибнут
    # потомки (так ведут себя MSYS-процессы), — поэтому смотрим на процесс.
    alive "$pid" || return 0
    sleep 1
  done
  return 1
}

# Кто запустил слушателей портов и чьи они; см. dev-screenshot-procs.ps1.
tree_report() { # аргументы помощника: -Ports …, -Roots …, -Leftovers
  if [ ! -f "$TREE_PS1" ] || ! command -v powershell >/dev/null 2>&1; then return 0; fi
  powershell -NoProfile -ExecutionPolicy Bypass -File "$(win_path "$TREE_PS1")" \
    -Checkout "$(win_path "$ROOT")" "$@" 2>/dev/null | tr -d '\r' || true
}

# Запуск сервера: субшелл подменяет себя командой (exec), а его stdin/stdout/stderr
# отвязаны от скрипта. Прежняя форма `( … nohup CMD >log 2>&1 & )` оставляла
# bash-обёртку, ждущую CMD с открытым stdout скрипта, — конвейер вида
# `dev-screenshot.sh up | tail` не завершался, пока жив стенд (#296).
# PID субшелла переживает exec в MSYS, поэтому по нему down находит корень дерева.
launch() { # $1 = имя, $2 = каталог, $3 = журнал, остальное — команда
  local name="$1" dir="$2" logfile="$3"
  shift 3
  (
    cd "$dir" && exec nohup "$@" > "$logfile" 2>&1 < /dev/null
  ) > /dev/null 2>&1 < /dev/null &
  echo "$name $!" >> "$FLAG"
}

stop_servers() {
  local report roots="" name pid owner command port listener foreign=" "
  # 1. Пускачи, записанные при up: дерево снимается, даже если слушателя сейчас нет.
  #    Перед taskkill помощник сверяет, что дерево ссылается на этот каталог:
  #    записанный PID мог быть переиспользован другим процессом.
  if [ -f "$FLAG" ]; then
    while read -r name pid rest; do
      case "$pid" in ''|*[!0-9]*) continue ;; esac
      pid="$(winpid_of "$pid")"
      [ -n "$pid" ] && roots="${roots:+$roots;}$name:$pid"
    done < "$FLAG"
  fi
  if [ -n "$roots" ]; then
    tree_report -Roots "$roots" | while IFS=$'\t' read -r kind name pid owner command; do
      [ "$kind" = recorded ] || continue
      case "$owner" in
        gone) ;; # пускач уже завершился вместе со своим сервером
        own)
          if kill_tree "$pid"; then log "остановлено дерево $name (PID $pid)"
          else log "НЕ остановлено дерево $name (PID $pid)"; fi ;;
        *) log "пускач $name не остановлен ($owner) — возможно, PID переиспользован" ;;
      esac
    done
  fi
  # 2. Слушатели портов стенда: корень цепочки запуска — если она из этого каталога.
  report="$(tree_report -Ports "$API_PORT,$WEB_PORT")"
  while IFS=$'\t' read -r kind port pid owner listener command; do
    [ "$kind" = port ] || continue
    case "$owner" in
      own)
        if kill_tree "$pid"; then log "остановлено дерево слушателя :$port (PID $pid)"
        else log "НЕ остановлено дерево слушателя :$port (PID $pid)"; fi ;;
      foreign)
        foreign="$foreign$listener "
        log ":$port держит стенд из другого каталога — не трогаю: $command" ;;
      *)
        log ":$port держит процесс без признаков стенда: $command" ;;
    esac
  done <<< "$report"
  # 3. Оставшиеся слушатели — как прежде; чужие (см. выше) пропускаются.
  for pid in $(port_pids "$API_PORT") $(port_pids "$WEB_PORT"); do
    case "$foreign" in *" $pid "*) continue ;; esac
    taskkill //PID "$pid" //F >/dev/null 2>&1 || true
  done
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
    log "ПОРТ $API_PORT/$WEB_PORT ЗАНЯТ:"
    tree_report -Ports "$API_PORT,$WEB_PORT" | while IFS=$'\t' read -r kind port pid owner listener command; do
      [ "$kind" = port ] || continue
      case "$owner" in
        foreign) log "  :$port — стенд из другого каталога, его не трогать: $command" ;;
        *) log "  :$port — останови командой down (корень дерева PID $pid): $command" ;;
      esac
    done
    exit 1
  fi
  trap 'stop_servers; restore_config; exit 130' INT TERM HUP

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

  # 2. Временный прокси web → :3005. Флаг хранит пускачей серверов и напоминает
  #    down, что конфиг правился.
  rm -f "$FLAG"
  if ! grep -q "localhost:$API_PORT" "$WEB_CONFIG"; then
    node -e "
const fs = require('fs');
const p = process.argv[1];
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('localhost:3001')) { console.error('в next.config.ts нет :3001 — проверьте вручную'); process.exit(1); }
s = s.replace('localhost:3001', 'localhost:$API_PORT');
fs.writeFileSync(p, s);
" "$WEB_CONFIG" && log "прокси /api → :$API_PORT (временная правка)"
  fi
  touch "$FLAG"

  # 3. API на тест-БД. 4. web.
  launch api "$ROOT/apps/api" /tmp/dkp-shot-api.log \
    env PORT=$API_PORT AUTH_TEST_MODE=true WEB_URL="http://localhost:$WEB_PORT" \
      DATABASE_URL="$TEST_DB" pnpm dev
  launch web "$ROOT/apps/web" /tmp/dkp-shot-web.log npx next dev -p "$WEB_PORT"

  for _ in $(seq 1 45); do
    sleep 2
    api=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/health" || true)
    web=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" || true)
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
  stop_servers
  restore_config
  for _ in 1 2 3 4 5; do
    [ -z "$(port_pids "$API_PORT")$(port_pids "$WEB_PORT")" ] && break
    sleep 1
  done
  if [ -n "$(port_pids "$API_PORT")$(port_pids "$WEB_PORT")" ]; then
    log "НЕ ОСТАНОВЛЕНО — порты заняты (PID: $(port_pids "$API_PORT"; port_pids "$WEB_PORT" | tr '\n' ' ')); подробности: $0 status"
    exit 1
  fi
  log "стенд остановлен"
  ;;
status)
  for p in "$API_PORT" "$WEB_PORT"; do
    if [ -n "$(port_pids "$p")" ]; then
      code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/health" || true)
      if [ "$code" != 200 ]; then code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/" || true); fi
      log ":$p занят (LISTEN), HTTP $code"
    else
      log ":$p свободен"
    fi
  done
  tree_report -Ports "$API_PORT,$WEB_PORT" | while IFS=$'\t' read -r kind port pid owner listener command; do
    [ "$kind" = port ] || continue
    case "$owner" in
      own) log ":$port — стенд этого каталога, корень дерева PID $pid" ;;
      foreign) log ":$port — стенд ДРУГОГО каталога, не трогать: $command" ;;
      *) log ":$port — процесс без признаков стенда: $command" ;;
    esac
  done
  # Пускачи этого каталога безотносительно портов: watcher nest и next dev.
  # Среди них может быть обычный dev-API (:3001), не только остаток стенда.
  tree_report -Leftovers | while IFS=$'\t' read -r kind pid created command; do
    [ "$kind" = leftover ] || continue
    log "пускач этого каталога (PID $pid, запущен $created): $command"
  done
  ;;
*)
  echo "usage: $0 up|down|status" >&2; exit 2 ;;
esac
