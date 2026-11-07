#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
compose() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }
test -f .env.production || { echo 'Нет .env.production' >&2; exit 1; }
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
compose up -d --wait api web caddy
