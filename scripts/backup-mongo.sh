#!/usr/bin/env bash
# Дамп базы в ./backups с суточной ротацией. Запускать с хоста, например из cron:
#   0 3 * * * cd /path/to/bitrix-kanban && ./scripts/backup-mongo.sh >> backups/backup.log 2>&1
set -euo pipefail

KEEP_DAYS="${KEEP_DAYS:-14}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$DIR/backups"
STAMP="$(date +%Y-%m-%d_%H-%M)"

# shellcheck disable=SC1091
set -a && source "$DIR/.env.local" && set +a

mkdir -p "$OUT"
docker compose --env-file "$DIR/.env.local" exec -T mongodb mongodump \
  --username "$MONGO_USERNAME" --password "$MONGO_PASSWORD" --authenticationDatabase admin \
  --db "${MONGO_DB:-bitrix_kanban}" --archive --gzip > "$OUT/bitrix_kanban_$STAMP.gz"

echo "[backup] готово: $OUT/bitrix_kanban_$STAMP.gz ($(du -h "$OUT/bitrix_kanban_$STAMP.gz" | cut -f1))"
find "$OUT" -name 'bitrix_kanban_*.gz' -mtime "+$KEEP_DAYS" -delete
