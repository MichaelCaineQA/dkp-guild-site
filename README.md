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

### Staging и production

Production-конфигурация подготовлена в `docker-compose.prod.yml` и `Caddyfile`.
На отдельном Linux VPS установите Docker Engine с Compose и Git; направьте DNS
имён сайта и API на сервер, откройте порты 80 и 443. Не включайте проксирование
DNS через Cloudflare. Подойдут VPS с локацией в ЕС, например Selectel или
Timeweb Cloud, и домен у любого регистратора.

1. Разместите checkout проекта в постоянном каталоге сервера и скопируйте
   `.env.production.example` в `.env.production` в этом каталоге; ограничьте
   права файла: `chmod 600 .env.production`.
2. Укажите два домена, учётные данные PostgreSQL, Discord OAuth и резервного
   администратора. Значение `DATABASE_URL` должно соответствовать PostgreSQL;
   специальные символы пароля в URL кодируются percent-encoding. Создайте
   независимые секреты `SESSION_SECRET` и `CHECKIN_ENC_KEY` (последний —
   64 hex-символа, например `openssl rand -hex 32`). В Discord укажите callback
   `https://<API_HOST>/auth/discord/callback`.
3. Запустите `sh scripts/deploy-prod.sh`. Скрипт собирает образы, останавливает
   API, делает снимок БД и файлов, применяет миграции и seed, запускает сервисы.
   При ошибке миграции API остаётся остановленным до проверки. Caddy получает
   сертификаты автоматически; проверьте `https://<API_HOST>/health` и сайт.

Для ручного workflow `Deploy` настройте GitHub environments `staging` и
`production`: secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
`DEPLOY_KNOWN_HOSTS` (проверенный ключ сервера) и variable `DEPLOY_PATH`
(абсолютный путь к checkout с заранее настроенным `.env.production`).
Выберите нужный ref и окружение в Actions. Production принимает только тег;
правила подтверждения для GitHub environment настраиваются владельцем отдельно.
У staging должны быть отдельные домены, БД, секреты и каталог сервера.

Для локальной HTTPS-проверки используйте отдельный каталог и проект Compose,
отдельные порты и тестовые секреты; в env задайте `CADDY_TLS=tls internal`,
имена `localhost` и `api.localhost`, `HTTPS_PORT=8443`, `HTTP_PORT=8080`,
`PUBLIC_WEB_URL=https://localhost:8443` и `PUBLIC_API_URL=https://api.localhost:8443`,
затем запустите скрипт с отдельным `COMPOSE_PROJECT_NAME`. Сертификат
локального CA Caddy потребуется добавить в доверенные для браузера. Не используйте
для этого production-базу или production-секреты.

Резервную копию отдельно создаёт `sh scripts/backup-prod.sh`: `pg_dump` в
формате custom и архив тома скриншотов помещаются в `backups/<UTC-время>` с
ограниченными правами. Переменная `BACKUP_REMOTE` включает копирование через
`rsync` в заранее настроенное отдельное хранилище; ошибка копирования означает
неуспешный запуск. Например, в cron укажите абсолютные пути и установите
`BACKUP_REMOTE` на доступное по SSH хранилище. Настройте там хранение 30 дней и
контроль успешности заданий; локальные копии самостоятельно не удаляются.
Не реже раза в месяц проверяйте восстановление **в отдельной тестовой базе**:
создайте чистую БД, выполните `pg_restore --no-owner --no-privileges -d <test_db>
database.dump`, распакуйте `screenshots.tar.gz` в отдельный каталог и проверьте
запуск приложения и файлы. Не восстанавливайте поверх рабочей БД без плана
остановки и отдельной актуальной копии.

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

Команды `pnpm db:seed` и `pnpm db:seed:test` сами собирают `@dkp/shared`
и генерируют Prisma-клиент. `pnpm db:migrate` также предварительно собирает
общий пакет, чтобы автоматический seed новой БД мог импортировать его.
Каталог `packages/shared/dist` генерируется локально и не хранится в Git.

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
В CI миграции и конкурентные сценарии приёма и выборки дашборда проверяются на отдельной PostgreSQL `dkp_test`.
