#!/usr/bin/env bash
# Внешняя проверка живости. Если /api/health не ответил как надо, отправляет
# событие в Sentry — оттуда алерт уходит тем же путём, что и ошибки
# приложения. Ставить в cron на хосте (или на другой машине, что надёжнее):
#   */2 * * * * cd /path/to/bitrix-kanban && ./scripts/health-watch.sh >> backups/health.log 2>&1
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
set -a && source "$DIR/.env.local" && set +a

URL="${HEALTH_URL:-${BITRIX24_APP_URL:-https://bitrix-flow.duckdns.org}/api/health}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

body="$(curl -fsS --max-time 15 "$URL" 2>/dev/null)"
status=$?

# Отправка события в Sentry: тот же путь, что у ошибок приложения.
send_alert() {
  local kind="$1" message="$2" code="$3"
  if [ -z "${SENTRY_DSN:-}" ]; then
    echo "[$STAMP] SENTRY_DSN не задан — алерт отправить некуда" >&2
    return 1
  fi
  python3 - "$SENTRY_DSN" "$URL" "$message" "$code" "$kind" <<'PY'
import json, sys, urllib.request, uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

dsn, url, body, code, kind = sys.argv[1:6]
parsed = urlparse(dsn)
endpoint = f"{parsed.scheme}://{parsed.hostname}/api{parsed.path}/store/"
event = {
    "event_id": uuid.uuid4().hex,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "platform": "other",
    "level": "error",
    "logger": "health-watch",
    "environment": "production",
    "transaction": "/api/health",
    "tags": {"source": "health-watch", "curl_exit": code, "kind": kind},
    "exception": {"values": [{
        "type": kind,
        "value": f"{url}: {body[:300]}",
        "stacktrace": {"frames": [{"filename": "scripts/health-watch.sh"}]},
    }]},
}
request = urllib.request.Request(endpoint, data=json.dumps(event).encode(), method="POST")
request.add_header("Content-Type", "application/json")
request.add_header(
    "X-Sentry-Auth",
    f"Sentry sentry_version=7, sentry_key={parsed.username}, sentry_client=health-watch/1.0",
)
with urllib.request.urlopen(request, timeout=15) as response:
    print("[health-watch] алерт отправлен:", response.status)
PY
}

# Разбор JSON, а не grep по тексту: пробелы после двоеточия в ответе не должны ломать проверку.
is_ok() {
  printf '%s' "$1" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' 2>/dev/null
}

if [ $status -eq 0 ] && is_ok "$body"; then
  # Приложение живо, но фоновый поллер мог встать (портал не отвечает, токен протух,
  # очередь событий ушла другому приложению). Перезапуск такое не лечит, поэтому только
  # алерт: тот же текст не чаще раза в час.
  warnings="$(printf '%s' "$body" | python3 -c 'import json,sys; print("; ".join(json.load(sys.stdin).get("warnings", [])))' 2>/dev/null)"
  if [ -n "$warnings" ]; then
    WARN_STAMP="$DIR/backups/.last-warning"
    NOW=$(date +%s)
    LAST_TEXT="$(sed -n 2p "$WARN_STAMP" 2>/dev/null)"
    LAST_AT="$(sed -n 1p "$WARN_STAMP" 2>/dev/null || echo 0)"
    if [ "$warnings" != "$LAST_TEXT" ] || [ $((NOW - ${LAST_AT:-0})) -gt 3600 ]; then
      echo "[$STAMP] health WARNING: $warnings" >&2
      # Отметку «отправлено» ставим только после успешной отправки: Sentry отвечает 429, когда
      # исчерпана квота, и тогда алерт должен уйти при следующей проверке, а не через час.
      if send_alert "PollerStale" "$warnings" "0" 2>&1 | tail -1 >&2 && [ "${PIPESTATUS[0]}" -eq 0 ]; then
        printf '%s\n%s\n' "$NOW" "$warnings" > "$WARN_STAMP"
      fi
    fi
    exit 0
  fi
  rm -f "$DIR/backups/.last-warning"
  echo "[$STAMP] health ok"
  exit 0
fi

echo "[$STAMP] health FAILED (curl=$status): ${body:-нет ответа}" >&2

# Попытка вернуть сайт самим: docker дважды за сутки ронял внутренний DNS, и
# прокси отдавал 502 при живом приложении. Пересоздание стека это лечит.
# Повторяем не чаще раза в 15 минут, чтобы не крутить рестарты по кругу.
RECOVER_STAMP="$DIR/backups/.last-recover"
NOW=$(date +%s)
LAST=$(cat "$RECOVER_STAMP" 2>/dev/null || echo 0)
if [ $((NOW - LAST)) -gt 900 ]; then
  echo "$NOW" > "$RECOVER_STAMP"
  echo "[$STAMP] пробую поднять стек заново" >&2
  (cd "$DIR" && docker compose --env-file .env.local up -d --force-recreate >/dev/null 2>&1) || true
  sleep 25
  if is_ok "$(curl -fsS --max-time 15 "$URL" 2>/dev/null)"; then
    echo "[$STAMP] поднялся сам, алерт не шлём"
    exit 0
  fi
fi

send_alert "HealthCheckFailed" "не отвечает как живой: ${body:-нет ответа}" "$status"
exit 1
