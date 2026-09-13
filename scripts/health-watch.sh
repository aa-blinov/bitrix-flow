#!/usr/bin/env bash
# Внешняя проверка живости. Если /api/health не ответил как надо, отправляет
# событие в GlitchTip — оттуда алерт уходит тем же путём, что и ошибки
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

if [ $status -eq 0 ] && printf '%s' "$body" | grep -q '"status":"ok"'; then
  echo "[$STAMP] health ok"
  exit 0
fi

echo "[$STAMP] health FAILED (curl=$status): ${body:-нет ответа}" >&2

if [ -z "${GLITCHTIP_DSN:-}" ]; then
  echo "[$STAMP] GLITCHTIP_DSN не задан — алерт отправить некуда" >&2
  exit 1
fi

python3 - "$GLITCHTIP_DSN" "$URL" "${body:-нет ответа}" "$status" <<'PY'
import json, sys, urllib.request, uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

dsn, url, body, code = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
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
    "tags": {"source": "health-watch", "curl_exit": code},
    "exception": {"values": [{
        "type": "HealthCheckFailed",
        "value": f"{url} не отвечает как живой: {body[:300]}",
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
exit 1
