#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
compose() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }
backup_dir=${BACKUP_DIR:-./backups}
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/$stamp"
mkdir "$target"
trap 'rm -rf "$target"' EXIT HUP INT TERM
compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$target/database.dump"
test -s "$target/database.dump"
# Том читается одноразовым контейнером для архивации.
compose run --rm --no-deps --entrypoint tar api -C /app/uploads/screenshots -czf - . > "$target/screenshots.tar.gz"
chmod 600 "$target/database.dump" "$target/screenshots.tar.gz"
trap - EXIT HUP INT TERM
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a -- "$target" "$BACKUP_REMOTE/"
fi
printf '%s\n' "Резервная копия: $target"
