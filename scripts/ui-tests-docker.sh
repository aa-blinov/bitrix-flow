#!/usr/bin/env bash
# Эталоны скриншотов снимаются и сверяются в том же образе, что использует CI.
# Иначе локальный Chrome рисует шрифты чуть иначе и сравнение падает.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

docker compose -f "$DIR/docker-compose.test.yml" up -d
docker run --rm --network host \
  -v "$DIR":/app -w /app \
  -e CI=true \
  "$IMAGE" \
  bash -lc "npm ci --no-audit --no-fund >/dev/null && node scripts/seed-test-db.mjs && npx playwright test $*"
