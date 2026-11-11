#!/usr/bin/env bash
# Эталоны скриншотов снимаются и сверяются в том же образе, что использует CI.
# Иначе локальный Chrome рисует шрифты чуть иначе и сравнение падает.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

docker compose -f "$DIR/docker-compose.test.yml" up -d
# Контейнер идёт от имени владельца репозитория: от root он оставлял node_modules, .next
# и результаты тестов чужими, и после прогона их приходилось возвращать через chown.
# npm ci только при смене package-lock: переустановка зависимостей занимала минуту на
# каждом прогоне. Сборка пропускается так же, см. scripts/ui-build.sh.
# nice: прогон идёт в фоне рабочего сервера и не должен отнимать процессор у прода.
docker run --rm --network host --ipc=host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp/home \
  -v "$DIR":/app -w /app \
  -e CI=true -e UI_WORKERS="${UI_WORKERS:-2}" \
  "$IMAGE" \
  bash -lc 'lock=$(sha256sum package-lock.json | cut -d" " -f1)
    if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "$lock" ]; then
      npm ci --no-audit --no-fund >/dev/null && echo "$lock" > node_modules/.lock-hash
    fi
    node scripts/seed-test-db.mjs && nice -n 10 npx playwright test "$@"' bash "$@"
