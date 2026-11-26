#!/bin/sh
# Изолированная проверка сценария настройки на настоящей Uptime Kuma: временный
# проект с томом и сетью, план, два применения (второе — без изменений), смена
# окружения и статус; в конце проект и том удаляются. Адреса мониторов — .invalid,
# поэтому проверка не обращается к настоящему сайту.
set -eu
cd "$(dirname "$0")/../.."
compose() { docker compose -f docker-compose.monitoring.yml "$@"; }
export COMPOSE_PROJECT_NAME="dkp-monitoring-smoke-$$"
env_file=$(mktemp)
out=$(mktemp)
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ]; then
    echo '--- kuma-setup output' >&2
    cat "$out" >&2 || true
    echo '--- kuma logs' >&2
    compose logs --no-color --tail=60 >&2 || true
  fi
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
echo "Uptime Kuma provisioning smoke passed ($version)"
