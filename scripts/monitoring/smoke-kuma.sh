#!/bin/sh
# Изолированная проверка мониторинга на настоящей Uptime Kuma: временный проект
# с томом и сетью. Первая часть — сценарий настройки (план, два применения,
# смена окружения, статус); вторая — канал «бот в личку»: Kuma шлёт вебхук
# ретранслятору, тот ходит в заглушку Discord. В конце всё удаляется. Адреса
# мониторов — .invalid, поэтому проверка не обращается к настоящему сайту.
set -eu
cd "$(dirname "$0")/../.."
compose() { docker compose -f docker-compose.monitoring.yml "$@"; }
export COMPOSE_PROJECT_NAME="dkp-monitoring-smoke-$$"
network="${COMPOSE_PROJECT_NAME}_default"
env_file=$(mktemp)
out=$(mktemp)
fake_discord=
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ]; then
    echo '--- kuma-setup output' >&2
    cat "$out" >&2 || true
    echo '--- kuma logs' >&2
    compose logs --no-color --tail=60 >&2 || true
    if [ -n "$fake_discord" ]; then
      echo '--- fake discord logs' >&2
      docker logs "$fake_discord" >&2 || true
    fi
  fi
  [ -z "$fake_discord" ] || docker rm -f "$fake_discord" > /dev/null 2>&1 || true
  compose down --volumes --remove-orphans > /dev/null 2>&1 || true
  rm -f "$env_file" "$out"
  exit "$result"
}
trap cleanup EXIT HUP INT TERM

export MONITORING_ENV_FILE="$env_file"
printf '%s\n' \
  'KUMA_PASSWORD=smoke-only-password' \
  'KUMA_PRODUCTION_HOST=prod.monitoring-smoke.invalid' \
  'KUMA_STAGING_HOST=stage.monitoring-smoke.invalid' \
  'KUMA_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1/smoke' \
  > "$env_file"
compose up -d --wait --wait-timeout 300 > /dev/null
version=$(compose config --images | sed 's/.*://')

# Сценарий пишет отчёт в файл: проверяются и код выхода, и строки отчёта.
setup() {
  sh scripts/monitoring/kuma-setup.sh "$@" > "$out" 2>&1 || {
    echo "ОЖИДАЛОСЬ: kuma-setup $* завершается без ошибки" >&2
    return 1
  }
}
fail() {
  echo "ОЖИДАЛОСЬ: $1" >&2
  return 1
}
expect() { grep -Fxq -- "$1" "$out" || fail "в отчёте kuma-setup есть строка «$1»"; }
contains() { grep -Fq -- "$1" "$out" || fail "в отчёте kuma-setup есть «$1»"; }
absent() { ! grep -Fq -- "$1" "$out" || fail "в отчёте kuma-setup нет «$1»"; }

setup apply --dry-run
expect 'Учётная запись: будет создана (сейчас только план)'
setup apply
expect 'Учётная запись: создана'
expect 'ИТОГ (записано): создано 6, изменено 0, удалено 0, без изменений 0'
setup apply
expect 'Учётная запись: уже есть'
expect 'ИТОГ (записано): создано 0, изменено 0, удалено 0, без изменений 6'

# Стенд выключен, канал убран: мониторы стенда и уведомление удаляются, а Kuma
# сама каскадом снимает привязку канала с мониторов production.
printf '%s\n' \
  'KUMA_PASSWORD=smoke-only-password' \
  'KUMA_PRODUCTION_HOST=prod.monitoring-smoke.invalid' \
  > "$env_file"
setup apply
expect 'Уведомления: создано — —; обновлено — —; удалено — DKP: Discord; без изменений — —'
expect 'ИТОГ (записано): создано 0, изменено 0, удалено 3, без изменений 3'
setup apply
expect 'ИТОГ (записано): создано 0, изменено 0, удалено 0, без изменений 3'

setup status
expect "Kuma $version"
contains 'Прод: API — здоровье: '
contains 'Прод: сайт — страница входа: '
contains 'Прод: WebSocket (аукцион): '
absent 'Стенд: '

# Канал «бот в личку». Заглушка Discord работает в сети проекта, ретранслятор
# включается профилем alerts и ходит только в заглушку.
fake_discord="dkp-monitoring-smoke-discord-$$"
docker run -d --name "$fake_discord" --network "$network" --network-alias fake-discord \
  --volume "$PWD/scripts/monitoring:/fake:ro" node:22-alpine \
  node /fake/fake-discord.mjs 8099 > /dev/null
relay_token=smoke-relay-token-0123456789
export COMPOSE_PROFILES=alerts
export ALERT_RELAY_TOKEN="$relay_token"
export ALERT_BOT_TOKEN=smoke-bot-token
export ALERT_DISCORD_USER_IDS=111111111111111111
export DISCORD_API_BASE=http://fake-discord:8099
compose up -d --wait --wait-timeout 120 > /dev/null
docker run --rm --network "$network" node:22-alpine \
  node -e "fetch('http://alert-relay:8080/alert', { method: 'POST', body: '{}' }).then((r) => process.exit(r.status === 401 ? 0 : 1), () => process.exit(1))" \
  || fail 'ретранслятор без секрета отвечает 401'

printf '%s\n' \
  'KUMA_PASSWORD=smoke-only-password' \
  'KUMA_PRODUCTION_HOST=prod.monitoring-smoke.invalid' \
  "ALERT_RELAY_TOKEN=$relay_token" \
  > "$env_file"
setup apply --dry-run
expect 'Уведомления: создано — DKP: бот в личку; обновлено — —; удалено — —; без изменений — —'
setup apply
expect 'Уведомления: создано — DKP: бот в личку; обновлено — —; удалено — —; без изменений — —'
expect 'ИТОГ (записано): создано 0, изменено 3, удалено 0, без изменений 0'
setup apply
expect 'ИТОГ (записано): создано 0, изменено 0, удалено 0, без изменений 3'
setup test-notification
expect '«DKP: бот в личку»: Sent Successfully.'
docker logs "$fake_discord" 2>&1 | grep -Fq 'Проверка оповещений' \
  || fail 'заглушка Discord получила личное сообщение от ретранслятора'
echo "Uptime Kuma provisioning smoke passed ($version, оповещения через ретранслятор)"
