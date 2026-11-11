#!/usr/bin/env bash
# Сборка для UI-тестов, только если исходники изменились с прошлой. Полная сборка Next
# идёт минуты и грузит машину, а повторный прогон тестов без правок кода её не требует.
# Отпечаток считается по содержимому файлов, а не по коммиту: правки до коммита тоже в счёт.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

STAMP=.next/standalone/.ui-build-hash
hash=$(find src public package-lock.json next.config.ts tsconfig.json postcss.config.mjs \
  -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)

if [[ -f .next/standalone/server.js && -f $STAMP && $(cat "$STAMP") == "$hash" ]]; then
  echo "[ui-build] исходники не менялись, сборка $hash переиспользуется"
  exit 0
fi

npm run build
# standalone-сборка не тащит статику рядом с собой: без копирования браузер получает
# 404 на все чанки и страница остаётся мёртвой.
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
echo "$hash" > "$STAMP"
