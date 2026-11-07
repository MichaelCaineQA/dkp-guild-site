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

### Вариант A — весь сайт в Docker одной командой

Нужен только запущенный Docker Desktop (Windows/macOS). Собирает образы,
поднимает web + api + PostgreSQL + Redis, применяет миграции и стартовые
данные при запуске:

```bash
pnpm site:up     # web: http://localhost:3000, api: http://localhost:3001/health
pnpm site:down   # остановить (данные БД сохраняются в томе)
pnpm site:logs   # логи api и web
```

**Запуск Docker Desktop из терминала** — если иконка на рабочем столе
не открывает окно (бывает после сбоев/зависших процессов):

```bash
# Windows, Git Bash:
"/c/Program Files/Docker/Docker/Docker Desktop.exe" &
# Windows, PowerShell:
Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
# macOS:
open -a Docker
```

Готовность движка (~30–60 сек) проверяется командой `docker info` —
она должна вывести версию сервера, а не ошибку подключения. Если
Docker «залип» (процессы есть, движок не отвечает): завершить все
процессы Docker в диспетчере задач и запустить снова командой выше;
при проблемах WSL помогает `wsl --shutdown`, затем старт Docker.

Секреты (Discord, `SESSION_SECRET`, …) читаются из `apps/api/.env` —
см. раздел «Вход через Discord» ниже. Без файла сайт поднимется с
dev-дефолтами, но вход будет только через настроенный Discord OAuth
(или резервный админ, если задан `ADMIN_PASSWORD`).

**Если порты заняты/заблокированы** (на Windows после перезапуска Docker
WinNAT может резервировать диапазоны — ошибка `ports are not available`
или `EACCES`): задайте свои порты в **корневом** `.env`:

```env
SITE_WEB_PORT=3080
SITE_API_PORT=3081
NEXT_PUBLIC_API_URL=http://localhost:3081   # = SITE_API_PORT
WEB_URL=http://localhost:3080               # = SITE_WEB_PORT
```

Проверить зарезервированные диапазоны:
`netsh interface ipv4 show excludedportrange protocol=tcp` (Windows).
Не забудьте также `DISCORD_CALLBACK_URL` — см. ниже.

### Вариант B — обычная разработка (web/api локально)

Нужны Node.js ≥ 20, pnpm и Docker:

```bash
corepack enable          # если pnpm ещё не установлен
pnpm install
docker compose up -d     # PostgreSQL + Redis
pnpm db:generate         # сгенерировать Prisma-клиент
pnpm db:migrate          # применить миграции (создать таблицы)
pnpm db:seed             # стартовые данные: гильдия, типы ивентов, настройки
pnpm dev                 # web: http://localhost:3000, api: http://localhost:3001/health
```

Переменные окружения — по образцу [.env.example](.env.example) (копируются
в `apps/api/.env`). Для миграций и seed нужен `DATABASE_URL`.

## Контракт API (Swagger / OpenAPI)

При запущенном API интерактивная документация доступна на
[http://localhost:3001/docs](http://localhost:3001/docs), JSON-контракт — на
[http://localhost:3001/openapi.json](http://localhost:3001/openapi.json)
(для Docker используйте свой `SITE_API_PORT`). JSON можно импортировать в Postman
или генератор клиента. Документ строится из текущих маршрутов NestJS, схемы
запросов — из общей Zod-валидации; описания ответов находятся в `apps/api/src/openapi`.

Для **Try it out** сначала войдите в том же браузере через
`/auth/discord` или выполните `POST /auth/admin/login` в Swagger.
Браузер отправляет httpOnly-cookie `dkp.sid` автоматически. Успешность резервного
входа проверяйте по `ok`, затем вызовите `GET /auth/me`. Действия меняют реальные
данные текущего окружения. Тестовый вход описывается только при `AUTH_TEST_MODE=true`.

## Вход через Discord (OAuth2)

1. Создайте приложение на <https://discord.com/developers/applications>.
2. В **OAuth2 → Redirects** добавьте URI вида
   `http://localhost:<порт API>/auth/discord/callback`
   (порт тот, на котором API реально доступен из браузера:
   `3001` для `pnpm dev`, `SITE_API_PORT` для Docker).
3. В `apps/api/.env` заполните:
   ```env
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   DISCORD_CALLBACK_URL=http://localhost:3001/auth/discord/callback
   SESSION_SECRET=...   # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Первый вошедший пользователь становится Главой гильдии.** Остальные
   входят как непривязанные аккаунты и отправляют заявку на привязку ника —
   офицеры подтверждают её на странице «Заявки».
5. Резервный вход админа (если Discord недоступен): `ADMIN_LOGIN` /
   `ADMIN_PASSWORD` в том же `.env`.

Если Discord после логина «не возвращает на сайт» — почти всегда это
несовпадение `DISCORD_CALLBACK_URL` с фактическим портом API (проверьте
адресную строку) или отсутствие этого URI в списке Redirects приложения.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm site:up` / `pnpm site:down` / `pnpm site:logs` | весь сайт в Docker / остановить / логи |
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
зелёный CI обязателен, ревью — по желанию. Правила проекта для людей
и ИИ-ассистентов — [AGENTS.md](AGENTS.md).

### Приватные скриншоты профиля

Файлы PNG, JPG/JPEG и WebP до 10 МБ загружаются через `POST /screenshots`
(`multipart/form-data`, поле `file`). Доступ к `GET /screenshots/:id` проверяется
по сессии: владелец, Глава или Админ. Статической публичной раздачи нет.
В обычной разработке каталог — `apps/api/uploads/screenshots` (или `SCREENSHOT_DIR`).
При `pnpm site:up` файлы сохраняются в отдельном томе `screenshot-data`;
его нужно включать в резервную копию вместе с PostgreSQL.
После обновления схемы примените миграции к локальной БД перед запуском API.
В CI миграции и конкурентные сценарии приёма проверяются на отдельной PostgreSQL `dkp_test`.
