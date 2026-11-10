# ДКП-система гильдии (Throne and Liberty)

Сайт для гильдии: расписание ивентов с игровым временем (день/ночь), отметка
посещения чек-ин кодами, ДКП-журнал, открытый аукцион лута, профили игроков
(прайм-тайм, gear score), структура КП/паков и статистика.

**Полный план проекта: [docs/PLAN.md](docs/PLAN.md)** — требования, механики,
зафиксированные решения гильдии (раздел 12), этапы разработки.

Содержание:

- [Быстрый старт (локально)](#быстрый-старт-локально)
- [Развёртывание и эксплуатация](#развёртывание-и-эксплуатация)
- [Контракт API](#контракт-api-swagger--openapi)
- [Вход через Discord](#вход-через-discord-oauth2)
- [Команды](#команды)
- [Тестирование](#тестирование)
- [Разработка](#разработка)

## Стек

- Монорепозиторий: pnpm workspaces + Turborepo, TypeScript strict
- Frontend: Next.js (React) — `apps/web`
- Backend: NestJS + Prisma + PostgreSQL — `apps/api`
- Общий код (типы, zod-схемы, логика ДКП и игрового времени) — `packages/shared`
- Realtime (аукцион): Socket.IO + Redis — подключается на этапе 2
- CI: GitHub Actions — lint → typecheck → test → build → audit

## Быстрый старт (локально)

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

## Развёртывание и эксплуатация

### Установщик релизов на VPS (простой путь)

По тегу `v*` workflow Release публикует на GitHub Releases архив
`dkp-guild-site-<версия>.tar.gz` с контрольной суммой; образы api/web
(multi-arch amd64/arm64) уходят в GHCR и фиксируются в манифесте релиза
по digest. Установщик — скрипт `dkp` на Python 3 (только стандартная
библиотека) для Ubuntu 22.04/24.04. Нужны домен, чей DNS указывает на VPS,
свободные порты 80/443 и доступ администратора. Пошаговая инструкция —
[installer/README.md](installer/README.md); приёмка на чистой VM ещё
не проводилась (#75).

Обычно все команды запускаются через sudo (`./dkp help` — краткая справка):

- **`start`** — мастер первичной настройки: домен (проверяется DNS
  и подтверждается вручную), название гильдии, логин и пароль
  администратора, необязательный Discord и параметры резервного
  копирования. Недостающий Docker Engine с Compose устанавливает
  через apt после явного подтверждения. Затем скачивает образы по digest,
  применяет миграции и seed, поднимает `db`, `redis`, `api`, `web` и
  `caddy` (автоматический HTTPS) и ждёт успешного ответа
  `https://<домен>/api/health`.
- **`update [v1.2.3]`** — обновление до свежего или указанного релиза:
  скачивает архив с GitHub Releases, проверяет контрольные суммы
  и состав, создаёт резервную копию, останавливает API, применяет
  миграции и переводит установку на новый релиз. При ошибке миграции API
  остаётся остановленным (`status` подсвечивает проблему) до восстановления
  копии; смена образа сама по себе не откатывает БД.
- **`backup setup | now | list | restore <id>`** — резервные копии единым
  пакетом: дамп БД (`pg_dump`), архив скриншотов, конфигурация и манифест
  релиза. Пакет шифруется `openssl` (AES-256-CBC, PBKDF2) ключом
  восстановления и подписывается HMAC-SHA256; выгрузка по SSH на отдельный
  сервер (атомарно, без частичных файлов) или в локальный каталог, ротация —
  по сроку хранения. Расписание — ежедневный systemd-таймер с нужным
  часовым поясом. `restore` проверяет подпись и состав, поднимает релиз
  той же версии, предварительно создаёт страховочную копию и просит
  подтвердить домен; ключ восстановления нужен и для восстановления —
  храните его вне VPS и хранилища копий.
- **`status` / `logs [сервис]` / `stop` / `restart` / `configure` /
  `leader`** — версия, домен, результат последнего бэкапа, состояние
  контейнеров и health-проверка; логи `api|web|db|redis|caddy`; изменение
  домена, админа или Discord; напоминание назначить Главу через UI —
  установщик его не назначает.

Состояние установки — `/var/lib/dkp-guild` (конфигурация с правами 0600,
каталоги релизов и копий, флаг прерванной миграции). Сервисы работают
в изолированном Compose-проекте `dkp-guild`; одновременные операции
исключены файловой блокировкой, а команды управляют только этим проектом —
TeamSpeak и другие службы сервера не затрагиваются. Автоматическое
обновление рассчитано на публичные release assets; приватные релизы и образы
GHCR требуют отдельной авторизации GitHub/Docker и проверки видимости
пакетов владельцем репозитория.

### Deploy из исходников

Описанный ниже deploy из исходников — существующий способ развёртывания,
полностью управляемый из checkout репозитория. Production-конфигурация
подготовлена в `docker-compose.prod.yml` и `Caddyfile`. На отдельном Linux
VPS установите Docker Engine с Compose и Git; направьте DNS имён сайта и API
на сервер, откройте порты 80 и 443. Не включайте проксирование DNS через
Cloudflare. Подойдут VPS с локацией в ЕС, например Selectel или Timeweb
Cloud, и домен у любого регистратора (например, reg.ru).

1. Разместите checkout проекта в постоянном каталоге сервера и скопируйте
   `.env.production.example` в `.env.production` в этом каталоге; ограничьте
   права файла: `chmod 600 .env.production`.
2. Укажите два домена, учётные данные PostgreSQL и резервного
   администратора. Значение `DATABASE_URL` должно соответствовать PostgreSQL;
   специальные символы пароля в URL кодируются percent-encoding. Создайте
   независимые секреты `SESSION_SECRET` и `CHECKIN_ENC_KEY` (последний —
   64 hex-символа, например `openssl rand -hex 32`). В Discord укажите
   callback `https://<WEB_HOST>/api/auth/discord/callback`. Настройку Discord
   можно отложить: оставьте `DISCORD_CLIENT_ID` и `DISCORD_CLIENT_SECRET`
   пустыми; API запустится, а на экране входа останется доступ
   администратора. После заполнения обоих значений пересоздайте API через
   Compose; пересборка web не нужна.
3. Запустите `sh scripts/deploy-prod.sh`. Скрипт собирает образы,
   останавливает API, делает снимок БД и файлов, применяет миграции и seed,
   запускает сервисы. При ошибке миграции API остаётся остановленным до
   проверки. Caddy получает сертификаты автоматически; проверьте
   `https://<WEB_HOST>/api/health` и сайт.

Браузер обращается к API через `/api` на домене сайта. Caddy убирает этот
префикс перед передачей запроса API; cookie и приватные скриншоты проходят
тем же путём. Образ web по умолчанию собирается с `/api`, без привязки
к домену. Для будущего realtime зарезервирован путь `/api/socket.io/`: Caddy
поддерживает WebSocket через тот же прокси; сам gateway пока не реализован.
Отдельный `API_HOST` сохранён для совместимости существующего deploy
и диагностики. При обновлении добавьте новый callback в Discord Redirects
до переключения; для временного сохранения прежнего задайте
`DISCORD_CALLBACK_URL` явно. `PUBLIC_API_URL` больше не задаёт адрес API
для production web-образа.

### Деплой через GitHub Actions

Workflow `Deploy` запускается автоматически при пуше в `main`: коммит из
`main` уезжает на стенд через окружение `staging` (тот же механизм, что
и ручной запуск — `git archive` по SSH и `scripts/deploy-prod.sh`).
Для ручного запуска (workflow_dispatch) настроите GitHub environments
`staging` и `production`: secrets `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (проверенный ключ сервера)
и variable `DEPLOY_PATH` (абсолютный путь к checkout с заранее
настроенным `.env.production`).
Выберите нужный ref и окружение в Actions. Production принимает только тег;
правила подтверждения для GitHub environment настраиваются владельцем
отдельно. У staging должны быть отдельные домены, БД, секреты и каталог
сервера.

**Стенд `stage.suneclipse.ru`** (окружение `staging`, VPS 193.37.68.243):
checkout `/opt/dkp-guild-site` с локальным `.env.production`; каждый пуш
в `main` обновляет его автоматически. DNS-запись должна указывать прямо
на VPS (без проксирования Cloudflare), иначе Caddy не получит сертификат
Let's Encrypt и не будут работать WebSocket-обновления аукциона.

### Локальная HTTPS-проверка production-стека

Для локальной HTTPS-проверки используйте отдельный каталог и проект Compose,
отдельные порты и тестовые секреты; в env задайте `CADDY_TLS=tls internal`,
имена `localhost` и `api.localhost`, `HTTPS_PORT=8443`, `HTTP_PORT=8080`,
`PUBLIC_WEB_URL=https://localhost:8443` и
`PUBLIC_API_URL=https://api.localhost:8443`, затем запустите скрипт
с отдельным `COMPOSE_PROJECT_NAME`. Сертификат локального CA Caddy
потребуется добавить в доверенные для браузера. Не используйте для этого
production-базу или production-секреты.

### Резервные копии и восстановление (deploy из исходников)

Резервную копию отдельно создаёт `sh scripts/backup-prod.sh`: `pg_dump` в
формате custom и архив тома скриншотов помещаются в `backups/<UTC-время>` с
ограниченными правами. Переменная `BACKUP_REMOTE` включает копирование через
`rsync` в заранее настроенное отдельное хранилище; ошибка копирования
означает неуспешный запуск. Для ежедневной копии на Ubuntu:

1. Установите `cron`, `rsync` и `util-linux` (для `flock`):
   `sudo apt-get install cron rsync util-linux`. На сервере хранения тоже
   нужен `rsync`. Подготовьте отдельный каталог, например
   `/srv/dkp-backups/dkp-guild-site`, и SSH-доступ к нему по ключу.
2. Настройте и проверьте `known_hosts` и SSH-ключ **root**, поскольку cron
   ниже выполняется от root. Проверьте `sudo ssh -o BatchMode=yes
   dkp-backup@backup.example.net true`; ключ сервера сверяйте отдельно.
3. Скопируйте `scripts/backup-prod.cron` во временный файл, укажите реальный
   абсолютный путь checkout (в примере `/opt/dkp-guild-site`) и
   `BACKUP_REMOTE`. Установите его: `sudo install -o root -g root -m 644
   <файл> /etc/cron.d/dkp-guild-backup`, затем `sudo systemctl enable --now
   cron`. Копия запускается ежедневно в 03:00 **по часовому поясу хоста**;
   `timedatectl` показывает его. `flock` предотвращает наложение
   cron-запусков.
4. До ожидания расписания выполните вручную:
   `sudo env BACKUP_REMOTE=dkp-backup@backup.example.net:/srv/dkp-backups/dkp-guild-site
   sh /opt/dkp-guild-site/scripts/backup-prod.sh`. Убедитесь, что оба файла
   появились на другом сервере. Проверяйте код возврата и
   `/var/log/dkp-guild-backup.log`; настройте оповещение при ошибках
   и ротацию этого лога средствами хоста.
5. На отдельном хранилище настройте lifecycle удаления копий старше 30
   дней. Для обычного Linux-хоста добавьте в crontab пользователя хранилища
   (`crontab -e`) ежедневную очистку **выделенного каталога этой системы**:

   ```cron
   0 5 * * * find /srv/dkp-backups/dkp-guild-site -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -mtime +29 -exec rm -rf -- {} +
   ```

   Сначала проверьте выборку той же командой с `-print` вместо
   `-exec ... +`. Локальные копии самостоятельно не удаляются; следите
   за свободным местом или примените такую же политику к выделенному
   каталогу `backups`. Для релизного установщика вместо этого используется
   `dkp backup setup` с собственным systemd-таймером; два расписания
   одновременно не настраивайте.

Не реже раза в месяц проверяйте восстановление **в отдельной тестовой
базе**: создайте чистую БД, выполните `pg_restore --no-owner
--no-privileges -d <test_db> database.dump`, распакуйте `screenshots.tar.gz`
в отдельный каталог и проверьте запуск приложения и файлы. Не
восстанавливайте поверх рабочей БД без плана остановки и отдельной
актуальной копии.

### Проверка инфраструктуры без сервера

Проверка выполняется workflow `Infrastructure` при PR, push в `main`
и вручную. Он проверяет все workflow через actionlint, валидирует Compose,
синтаксис shell-скриптов, тестирует порядок деплоя и обработку ошибок
с подставным Docker, затем собирает оба production-образа. После сборки он
поднимает изолированный стек с `tls internal`, проверяет HTTPS сайта
и `/api/health`, наличие снимка БД/скриншотов и удаляет только тестовые
контейнеры и тома. Локальный эквивалент (из корня checkout, нужны Docker,
curl и Python 3; порты 18080/18443 должны быть свободны):

```sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet
sh -n scripts/deploy-prod.sh
sh -n scripts/backup-prod.sh
sh -n scripts/smoke-prod.sh
python3 -m unittest discover -s scripts -p 'test_*.py' -v
sh scripts/smoke-prod.sh
```

Проверка не выполняет SSH-деплой, не читает production secrets и не меняет
рабочую БД. На пустой БД используйте `scripts/deploy-prod.sh`: обычный
`compose up` намеренно не применяет миграции без предварительной копии.
Скрипты deploy и backup принимают `PRODUCTION_ENV_FILE` (по умолчанию
`.env.production`); smoke использует временный файл, не заменяя рабочий env.

## Контракт API (Swagger / OpenAPI)

При запущенном API интерактивная документация доступна на
[http://localhost:3001/docs](http://localhost:3001/docs), JSON-контракт — на
[http://localhost:3001/openapi.json](http://localhost:3001/openapi.json)
(для Docker используйте свой `SITE_API_PORT`). JSON можно импортировать
в Postman или генератор клиента. Документ строится из текущих маршрутов
NestJS, схемы запросов — из общей Zod-валидации; описания ответов находятся
в `apps/api/src/openapi`.

Для **Try it out** сначала войдите в том же браузере через
`/auth/discord` или выполните `POST /auth/admin/login` в Swagger.
Браузер отправляет httpOnly-cookie `dkp.sid` автоматически. Успешность
резервного входа проверяйте по `ok`, затем вызовите `GET /auth/me`.
Действия меняют реальные данные текущего окружения. Тестовый вход
описывается только при `AUTH_TEST_MODE=true`.

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
4. Новые пользователи входят как непривязанные аккаунты и отправляют
   анкету — Глава/Админ подтверждает её на странице «Заявки». Первый
   случайный вход **не назначает Главу**; Админ назначает его через смену
   ранга в разделе «Состав» после одобрения участника (PLAN.md 12.12).
5. Резервный вход админа (если Discord недоступен): `ADMIN_LOGIN` /
   `ADMIN_PASSWORD` в том же `.env`. Без параметров Discord этот вход
   остаётся доступен. При частично заполненных параметрах Discord отключён;
   `/auth/providers` возвращает только `{ "discord": false }`, оба маршрута
   OAuth отвечают 503 с пояснением. После изменения настроек перезапустите
   API.

При `pnpm dev` адрес `/api` проксируется Next.js на `localhost:3001`.
Явный `NEXT_PUBLIC_API_URL` в `apps/web/.env.local` по-прежнему
поддерживается; локальный Docker Compose сохраняет прямой адрес API
и настройку его порта.

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

Процесс — в [CONTRIBUTING.md](CONTRIBUTING.md): ветки `feature/*`, PR в
`main`, зелёный CI обязателен, ревью — по желанию. Правила проекта для людей
и ИИ-ассистентов — [AGENTS.md](AGENTS.md).

### Приватные скриншоты профиля

Файлы PNG, JPG/JPEG и WebP до 10 МБ загружаются через `POST /screenshots`
(`multipart/form-data`, поле `file`). Доступ к `GET /screenshots/:id`
проверяется по сессии: владелец, Глава или Админ. Статической публичной
раздачи нет. В обычной разработке каталог —
`apps/api/uploads/screenshots` (или `SCREENSHOT_DIR`). При `pnpm site:up`
файлы сохраняются в отдельном томе `screenshot-data`; его нужно включать
в резервную копию вместе с PostgreSQL. После обновления схемы примените
миграции к локальной БД перед запуском API. В CI миграции и конкурентные
сценарии приёма и выборки дашборда проверяются на отдельной PostgreSQL
`dkp_test`.
