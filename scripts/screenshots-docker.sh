#!/usr/bin/env bash
# Скриншоты для README снимаются в том же образе, что и эталоны UI-тестов:
# иначе локальный Chrome рисует шрифты чуть иначе, и картинки в README
# будут отличаться от того, что видит пользователь на CI.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"
PORT="${SCREENSHOT_PORT:-3112}"
BASE_URL="http://127.0.0.1:${PORT}"

docker compose -f "$DIR/docker-compose.test.yml" up -d
docker run --rm --network host \
  -v "$DIR":/app -w /app \
  -e CI=true \
  "$IMAGE" \
  bash -lc "
    set -e
    npm ci --no-audit --no-fund >/dev/null
    node scripts/seed-test-db.mjs
    npm run build >/dev/null
    cp -r public .next/standalone/
    cp -r .next/static .next/standalone/.next/
    NODE_ENV=production PORT=${PORT} HOSTNAME=127.0.0.1 MOCK_B24=1 \
      MONGO_URL=mongodb://127.0.0.1:27018 MONGO_DB=bitrix_kanban_test \
      AUTH_USERNAME=tester AUTH_PASSWORD=tester-password AUTH_SESSION_SECRET=ui-tests-secret-value \
      BITRIX24_APP_URL=${BASE_URL} BITRIX24_REDIRECT_URI=${BASE_URL}/api/oauth \
      node .next/standalone/server.js &
    SERVER_PID=\$!
    for i in \$(seq 1 60); do
      if curl -fsS ${BASE_URL}/login >/dev/null 2>&1; then break; fi
      sleep 1
    done
    SCREENSHOT_URL=${BASE_URL} node scripts/capture-readme-screenshots.mjs
    kill \$SERVER_PID || true
  "
