#!/bin/sh
# Изолированная проверка: тестовый env, отдельные тома и проект Compose.
set -eu
cd "$(dirname "$0")/.."
smoke_dir=$(mktemp -d)
export PRODUCTION_ENV_FILE="$smoke_dir/env"
export COMPOSE_PROJECT_NAME="dkp-infra-smoke-$$"
export BACKUP_DIR="$smoke_dir/backups"
export BACKUP_REMOTE=''
compose() { docker compose --env-file "$PRODUCTION_ENV_FILE" -f docker-compose.prod.yml "$@"; }
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ]; then compose logs --tail=100 || true; fi
  compose down --volumes --remove-orphans || true
  rm -rf -- "$smoke_dir"
  exit "$result"
}
trap cleanup EXIT HUP INT TERM
cat > "$PRODUCTION_ENV_FILE" <<'ENV'
WEB_HOST=localhost
API_HOST=api.localhost
POSTGRES_USER=dkp
POSTGRES_DB=dkp
POSTGRES_PASSWORD=smoke-only-password
DATABASE_URL=postgresql://dkp:smoke-only-password@db:5432/dkp?schema=public
SESSION_SECRET=smoke-only-session-secret-at-least-32-characters
CHECKIN_ENC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ADMIN_LOGIN=admin
ADMIN_PASSWORD=smoke-only-admin-password
PUBLIC_WEB_URL=https://localhost:18443
HTTP_PORT=18080
HTTPS_PORT=18443
CADDY_TLS=tls internal
ENV
sh scripts/deploy-prod.sh
curl --insecure --fail --retry 15 --retry-connrefused --retry-delay 2 https://localhost:18443/api/health
curl --insecure --fail --retry 15 --retry-connrefused --retry-delay 2 --output /dev/null https://localhost:18443/
test -s "$BACKUP_DIR"/*/database.dump
test -s "$BACKUP_DIR"/*/screenshots.tar.gz
printf '\nProduction HTTPS smoke passed\n'
