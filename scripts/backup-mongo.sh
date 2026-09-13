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
FILE="$OUT/bitrix_kanban_$STAMP.gz"

dump() {
  docker compose --env-file "$DIR/.env.local" exec -T mongodb mongodump \
    --username "$MONGO_USERNAME" --password "$MONGO_PASSWORD" --authenticationDatabase admin \
    --db "${MONGO_DB:-bitrix_kanban}" --archive --gzip
}

# В дампе лежат OAuth-токены портала и хеши сессий, поэтому архив шифруем:
# файл может уехать в облако или на чужой диск отдельно от сервера.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  FILE="$FILE.enc"
  dump | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$FILE"
else
  echo "[backup] BACKUP_PASSPHRASE не задан — архив будет без шифрования" >&2
  dump > "$FILE"
fi

echo "[backup] готово: $FILE ($(du -h "$FILE" | cut -f1))"
find "$OUT" -name 'bitrix_kanban_*.gz' -mtime "+$KEEP_DAYS" -delete
find "$OUT" -name 'bitrix_kanban_*.gz.enc' -mtime "+$KEEP_DAYS" -delete
