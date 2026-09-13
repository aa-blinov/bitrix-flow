FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
# NEXT_PUBLIC_* инлайнится в клиентский бандл на сборке, поэтому приходит
# аргументом, а не переменной окружения контейнера.
ARG NEXT_PUBLIC_GLITCHTIP_DSN=""
ARG APP_RELEASE="dev"
ENV NEXT_PUBLIC_GLITCHTIP_DSN=$NEXT_PUBLIC_GLITCHTIP_DSN
ENV NEXT_PUBLIC_APP_RELEASE=$APP_RELEASE
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
