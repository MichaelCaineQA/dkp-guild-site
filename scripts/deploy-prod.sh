#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
env_file=${PRODUCTION_ENV_FILE:-.env.production}
# SHA сборки уходит в /api/health (контроль фактической версии стенда, #175).
# Workflow Deploy передаёт GIT_SHA явно (git archive без .git); при ручном
# запуске в checkout берём rev-parse; вне git — unknown.
GIT_SHA=${GIT_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)}
export GIT_SHA
compose() { docker compose --env-file "$env_file" -f docker-compose.prod.yml "$@"; }
test -f "$env_file" || { echo 'Нет файла production env' >&2; exit 1; }
compose config -q
compose build api web
compose up -d --wait db redis
# Останавливаем записи перед снимком; при ошибке копирования возвращаем старый API.
compose stop api
if ! sh scripts/backup-prod.sh; then
  compose start api || true
  exit 1
fi
# При ошибке миграции API остаётся остановленным до проверки и восстановления.
compose run --rm --no-deps api ./node_modules/.bin/prisma migrate deploy
compose run --rm --no-deps api node dist-seed/prisma/seed.js
# Запускаем только активные профили: общий edge обновляется отдельно от приложения.
compose up -d --wait
