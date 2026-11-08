# syntax=docker/dockerfile:1
# Web (Next.js standalone) — сборка монорепо внутри контейнера,
# рантайм — только server.js со статикой (~150 МБ).

FROM node:22-alpine AS build
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

# NEXT_PUBLIC_* вшивается в бандл на этапе сборки
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Включает output: 'standalone' в next.config.ts
ENV DOCKER_BUILD=1

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @dkp/shared build && pnpm --filter @dkp/web build

FROM node:22-alpine
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# Standalone-выход повторяет структуру монорепо: server.js в apps/web
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1
CMD ["node", "apps/web/server.js"]
