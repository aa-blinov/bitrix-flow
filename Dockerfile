FROM node:25-alpine AS dependencies
WORKDIR /app
# .npmrc едет вместе с манифестами: набор @monos/ui объявляет Tailwind 3 как
# peer-зависимость, а приложение живёт на Tailwind 4, и без
# legacy-peer-deps npm ci падает на ERESOLVE ещё до сборки.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:25-alpine AS builder
WORKDIR /app
# NEXT_PUBLIC_* инлайнится в клиентский бандл на сборке, поэтому приходит
# аргументом, а не переменной окружения контейнера.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG APP_RELEASE="dev"
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_APP_RELEASE=$APP_RELEASE
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# Токен Sentry приходит build-секретом, а не ARG: ARG остаётся в истории слоёв.
# Без секрета сборка идёт как обычно, просто без загрузки source maps.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN npm run build

FROM node:25-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
