#!/usr/bin/env bash
# Выкатка приложения с проверкой и откатом: собирает образ, перезапускает app и ждёт, пока
# приложение станет здоровым. Если не поднялось, возвращает образ, который работал до выкатки.
#   ./scripts/deploy.sh            # релиз = короткий хеш HEAD
#   ./scripts/deploy.sh 0.3.0      # релиз = версия (имя релиза в Sentry)
# Проверка отката без реального сбоя: DEPLOY_FORCE_FAIL=1 ./scripts/deploy.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
# shellcheck disable=SC1091
set -a && source "$DIR/.env.local" && set +a

RELEASE="${1:-$(git rev-parse --short HEAD)}"
URL="${HEALTH_URL:-${BITRIX24_APP_URL:-https://bitrix-flow.duckdns.org}/api/health}"
COMPOSE=(docker compose --env-file .env.local)
WAIT_S="${DEPLOY_WAIT_S:-150}"
STAMP() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Здоровье по docker и по самому приложению: healthy у контейнера не доказывает, что
# через прокси сайт отвечает, а ответ сайта не доказывает, что это уже новый контейнер.
healthy() {
  local container="$1" state
  [ -z "${DEPLOY_FORCE_FAIL:-}" ] || return 1
  state="$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo none)"
  [ "$state" = healthy ] || return 1
  curl -fsS --max-time 10 "$URL" 2>/dev/null |
    python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ok" else 1)' 2>/dev/null
}

wait_healthy() {
  local container="$1" waited=0
  while [ "$waited" -lt "$WAIT_S" ]; do
    healthy "$container" && return 0
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

OLD_CONTAINER="$("${COMPOSE[@]}" ps -q app 2>/dev/null || true)"
IMAGE_NAME=""
HAVE_PREVIOUS=""
if [ -n "$OLD_CONTAINER" ]; then
  IMAGE_NAME="$(docker inspect --format '{{.Config.Image}}' "$OLD_CONTAINER")"
  # Работающий образ сохраняем под своим именем до сборки: id образа после пересборки
  # под тем же именем уже не находился (старый становится безымянным и пропадает), а
  # имя с тегом остаётся.
  if docker tag "$IMAGE_NAME:latest" "$IMAGE_NAME:previous" 2>/dev/null; then HAVE_PREVIOUS=1; fi
fi

echo "[$(STAMP)] сборка релиза $RELEASE"
APP_RELEASE="$RELEASE" "${COMPOSE[@]}" build app
echo "[$(STAMP)] перезапуск app"
APP_RELEASE="$RELEASE" "${COMPOSE[@]}" up -d app

NEW_CONTAINER="$("${COMPOSE[@]}" ps -q app)"
if wait_healthy "$NEW_CONTAINER"; then
  mkdir -p backups
  echo "$(STAMP) $RELEASE" >> backups/.releases
  echo "[$(STAMP)] релиз $RELEASE выкачен и отвечает"
  exit 0
fi

echo "[$(STAMP)] релиз $RELEASE не поднялся за ${WAIT_S}с" >&2
"${COMPOSE[@]}" logs --tail 40 app >&2 || true
if [ -z "$HAVE_PREVIOUS" ]; then
  echo "[$(STAMP)] предыдущего образа нет, откатываться некуда" >&2
  exit 1
fi

# Образ прошлого релиза возвращаем под рабочим именем и поднимаем без пересборки.
echo "[$(STAMP)] откат на $IMAGE_NAME:previous" >&2
docker tag "$IMAGE_NAME:previous" "$IMAGE_NAME:latest"
APP_RELEASE="previous" "${COMPOSE[@]}" up -d --no-build --force-recreate app
ROLLED="$("${COMPOSE[@]}" ps -q app)"
if DEPLOY_FORCE_FAIL= wait_healthy "$ROLLED"; then
  echo "[$(STAMP)] откатились, работает прошлая версия" >&2
else
  echo "[$(STAMP)] откат тоже не поднялся, нужно смотреть руками" >&2
fi
exit 1
