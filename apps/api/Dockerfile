# syntax=docker/dockerfile:1
# API (NestJS + Prisma) — сборка монорепо целиком внутри контейнера.
# В рантайм уходят только прод-зависимости, dist и присланные миграции.

FROM node:22-alpine AS build
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable
WORKDIR /repo

# Сначала манифесты — слой зависимостей кешируется, пока не меняются
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/api apps/api
# prisma generate до сборки: nest build строгий, без сгенерированного
# клиента типы findMany — any и сборка падает
RUN pnpm --filter @dkp/shared build \
 && pnpm --filter @dkp/api exec prisma generate \
 && pnpm --filter @dkp/api build \
 && pnpm --filter @dkp/api exec tsc prisma/seed.ts \
    --outDir dist-seed --module commonjs --target es2022 \
    --esModuleInterop --skipLibCheck

# Прод-зависимости отдельным слоем: рантайм без dev-инструментов
FROM node:22-alpine AS deps-prod
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --prod --filter @dkp/api --filter @dkp/shared
# Сборные артефакты поверх установки: workspace-ссылки уже на месте
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/dist-seed apps/api/dist-seed
COPY --from=build /repo/apps/api/prisma apps/api/prisma
RUN cd apps/api && ./node_modules/.bin/prisma generate

FROM node:22-alpine
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps-prod /repo ./
WORKDIR /repo/apps/api
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
# Миграции + идемпотентный seed на каждом старте, затем сервер
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist-seed/prisma/seed.js && node dist/main.js"]
