#!/bin/sh
# Запускает kuma-setup.mjs одноразовым контейнером в сети мониторинга: Node.js
# на хосте не нужен, берётся образ самой Kuma.
#
#   sh scripts/monitoring/kuma-setup.sh [apply|status|test-notification] [--dry-run] [--watch N]
#
# Переменные читаются из .env.monitoring (MONITORING_ENV_FILE) — по строке
# KEY=ЗНАЧЕНИЕ без кавычек и комментариев в строке — и уходят в контейнер по
# именам; значения не печатаются. Kuma должна быть запущена: сеть создаёт её
# проект. Блокировку деплоя (/run/lock/dkp-deploy.lock) не занимает — у
# мониторинга свой проект и своя база.
set -eu
cd "$(dirname "$0")/../.."
env_file=${MONITORING_ENV_FILE:-.env.monitoring}
if [ -f "$env_file" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '' | '#'*) continue ;;
    esac
    export "$line"
  done < "$env_file"
fi

names='KUMA_URL KUMA_USERNAME KUMA_PASSWORD KUMA_PRODUCTION_HOST KUMA_STAGING_HOST KUMA_STAGING_NOTIFICATIONS KUMA_DISCORD_WEBHOOK_URL KUMA_SMTP_HOST KUMA_SMTP_PORT KUMA_SMTP_SECURE KUMA_SMTP_USERNAME KUMA_SMTP_PASSWORD KUMA_SMTP_FROM KUMA_SMTP_TO ALERT_RELAY_TOKEN ALERT_RELAY_URL'
args=
for name in $names; do args="$args --env $name"; done

# compose run подключает stdin: без /dev/null сценарий съедает остаток
# родительского скрипта, когда тот пришёл по ssh на stdin.
# shellcheck disable=SC2086
exec docker compose -f docker-compose.monitoring.yml run --rm --no-deps -T \
  --entrypoint node \
  --volume "$(pwd)/scripts/monitoring:/setup:ro" \
  $args uptime-kuma /setup/kuma-setup.mjs "$@" < /dev/null
