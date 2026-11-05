# ДКП-система гильдии (Throne and Liberty)

Сайт для гильдии: расписание ивентов с игровым временем (день/ночь), отметка
посещения чек-ин кодами, ДКП-журнал, открытый аукцион лута, профили игроков
(прайм-тайм, gear score), структура КП/паков и статистика.

**Полный план проекта: [docs/PLAN.md](docs/PLAN.md)** — требования, механики,
зафиксированные решения гильдии (раздел 12), этапы разработки.

## Стек

- Монорепозиторий: pnpm workspaces + Turborepo, TypeScript strict
- Frontend: Next.js (React) — `apps/web`
- Backend: NestJS + Prisma + PostgreSQL — `apps/api`
- Общий код (типы, zod-схемы, логика ДКП и игрового времени) — `packages/shared`
- Realtime (аукцион): Socket.IO + Redis — подключается на этапе 2
- CI: GitHub Actions — lint → typecheck → test → build → audit

## Быстрый старт

Нужны Node.js ≥ 20, pnpm и Docker.

```bash
corepack enable          # если pnpm ещё не установлен
pnpm install
docker compose up -d     # PostgreSQL + Redis
pnpm db:generate         # сгенерировать Prisma-клиент
pnpm db:migrate          # применить миграции (создать таблицы)
pnpm db:seed             # стартовые данные: гильдия, типы ивентов, настройки
pnpm build               # собрать shared → api, web
pnpm dev                 # web: http://localhost:3000, api: http://localhost:3001/health
```

Переменные окружения — по образцу [.env.example](.env.example).
Для миграций и seed нужен `DATABASE_URL` (значения по умолчанию совпадают
с docker-compose).

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` | dev-режим web + api |
| `pnpm build` | сборка всех пакетов |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | проверки по всему монорепо |
| `pnpm format` | prettier |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | Prisma-клиент / миграции / стартовые данные |
| `pnpm db:seed:test` | тестовые пользователи для e2e (см. ниже) |

## Тестирование

**Юнит-тесты** — `pnpm test` (обязательны в каждом PR, CI гоняет их же).

**Тестовый вход без Discord** (e2e, ручная проверка ролей на staging):

```bash
pnpm db:seed:test                          # создать test-leader/test-officer/test-member(-2)
# в apps/api/.env: AUTH_TEST_MODE=true     # и перезапустить API
curl -c cookies.txt -d '{"username":"test-officer"}' localhost:3001/auth/test-login
curl -b cookies.txt localhost:3001/auth/me # сессия с рангом OFFICER
```

Без `AUTH_TEST_MODE=true` ручка отвечает 404. В production приложение
с включённым флагом **не стартует** (fail-fast). Тестовые пользователи
создаются только с никами `test-*`, за реальных людей войти нельзя.

## Разработка

Процесс — в [CONTRIBUTING.md](CONTRIBUTING.md): ветки `feature/*`, PR в `main`,
зелёный CI обязателен, ревью — по желанию.
