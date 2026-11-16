# Разработка и проверки

Рабочие инструкции перенесены из AGENTS.md; подробности запуска —
в [README.md](../../README.md), процесс — в
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Локальная разработка

Нужны Node.js ≥ 20, pnpm (версия из `package.json`) и Docker.

```bash
pnpm install
docker compose up -d     # PostgreSQL + Redis
pnpm db:generate         # после изменения Prisma-схемы
pnpm db:migrate          # создать/применить миграции локально
pnpm db:seed             # стартовые данные
pnpm dev                # web :3000, api :3001
```

Для сайта целиком в Docker Desktop:

```bash
pnpm site:up             # сборка и запуск web, api, БД, Redis
pnpm site:down           # остановка с сохранением данных БД в томе
pnpm site:logs           # логи api и web
```

`site:up` использует `apps/api/Dockerfile` и `apps/web/Dockerfile`, применяет
миграции и идемпотентный seed при старте. Секреты читает из `apps/api/.env`;
без файла используются dev-дефолты, Discord-вход требует настроенного OAuth.
Резервный вход администратора требует `ADMIN_PASSWORD`.

**Миграции применяй только к локальной базе. Прод-миграции выполняет деплой.**
Production/staging и резервное копирование описаны в README.md; наличие
конфигурации в репозитории не подтверждает, что окружение уже развёрнуто.

## Проверки и изменения

- Перед PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- CI: lint, format:check, test:coverage (shared, минимум 80% statements/
  branches/functions/lines), typecheck, test, PostgreSQL, build, Playwright
  бизнес-сценарии, обязательный `pnpm audit --prod` без исключений (#171–172).
  Zod 4 использует нативный конвертер OpenAPI; у PATCH удалены defaults,
  чтобы отсутствующие поля не сбрасывали состав ивента. Для закреплённых
  родителями PostCSS/deepmerge-ts есть адресные overrides в pnpm-workspace.
- Отдельный `.github/workflows/infrastructure.yml` проверяет actionlint,
  Compose и shell-синтаксис, тестирует отказные сценарии деплоя без сервера
  (`python3 -m unittest discover -s scripts -p 'test_*.py' -v`), собирает
  production-образы. Ежедневный cron для deploy из исходников —
  `scripts/backup-prod.cron`; установка и внешнее хранилище описаны в README.
- Логику ядра покрывай юнит-тестами в том же PR; после изменения UI нужен
  скриншот в PR.
- Не добавляй зависимости без необходимости. Если добавил — выполни
  `pnpm install` и включи `pnpm-lock.yaml` в тот же коммит; CI устанавливает
  зависимости с `--frozen-lockfile`.
- Секреты — только в `.env` (образец `.env.example`), никогда в коде,
  истории Git или файлах памяти.
- Ветки `feature/*`, `fix/*`, `chore/*`, `docs/*` → PR в `main`.
  Ревью опционально, зелёный CI обязателен.
- Коммиты: `feat|fix|chore|docs|refactor: суть изменения` (по-русски можно).
- Не меняй чужие незакоммиченные правки в процессе своей задачи.

## Стенд stage.suneclipse.ru (переехал 2026-11-12)

Деплой из сессии по команде — скиллы `.agents/skills/dkp-deploy-stage` и
`.agents/skills/dkp-deploy-prod` (запуск workflow Deploy через GitHub API,
ожидание run, контроль SHA в /api/health; прод — полный релизный цикл с тегом
и Release).

- VPS **188.120.225.204** (FirstVDS, root, ключ `~/.ssh/dkp_stage`, alias
  `dkp-stage`), Ubuntu 24.04, 4 vCPU / 8 ГБ / 99 ГБ NVMe, Docker Engine
  + Compose; checkout `/opt/dkp-guild-site` с серверным `.env.production`
  (0600, секреты только там). Деплой — workflow `Deploy`: успешный CI пуша
  в `main` запускает staging для того же SHA через окружение GitHub `staging`
  (secrets `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY`/`DEPLOY_KNOWN_HOSTS`,
  variable `DEPLOY_PATH`); ручной workflow_dispatch выбирает окружение
  и для production требует тег из истории main (`release_tag` или tag ref).
  Production — `/opt/dkp-production`, проект `dkp-production`,
  `suneclipse.ru` / `api.suneclipse.ru`. Оба приложения: пустой
  `COMPOSE_PROFILES`, уникальные API_UPSTREAM/WEB_UPSTREAM; TLS — отдельный
  `/opt/dkp-edge` (docker-compose.edge.yml + Caddyfile.edge), сети обоих
  проектов. Одиночный deploy требует `COMPOSE_PROFILES=standalone` в env.
  Серверная блокировка deploy/cron — `/run/lock/dkp-deploy.lock`.
  Прежний VPS 193.37.68.243 выведен
  из эксплуатации (docker-демон и SSH зависали у прошлого провайдера).
- SSH (проверено 2026-11-16): root входит только по ключу. В
  `/etc/ssh/sshd_config.d/00-dkp-key-only.conf` заданы
  `PermitRootLogin prohibit-password`, `PasswordAuthentication no`,
  `KbdInteractiveAuthentication no`, `AuthenticationMethods publickey`.
  Настройки имеют приоритет над провайдерским `40-hosting.conf`.
  Ключ оператора — `~/.ssh/dkp_stage` (alias `dkp-stage`); ключи деплоя
  хранятся в environment Secrets `DEPLOY_SSH_KEY` для `staging` и
  `production`. Приватные ключи и пароль администратора сайта в Git не пишутся.
  После изменения sshd: `sshd -t`, reload `ssh`, затем проверка **нового**
  соединения с ключом; соединение без ключа должно получить
  `Permission denied (publickey)`.
- Проверка: `https://stage.suneclipse.ru/api/health`; вход — резервный
  админ из серверного `.env.production`. Realtime (#97): engine.io-handshake —
  `curl '.../api/socket.io/?EIO=4&transport=polling'` (ответ `0{"sid":...}`);
  неавторизованный сокет-клиент получает `auction:error` и disconnect.
- **Ожидание деплоя (#172): CI пуша в main завершается первым, затем
  workflow_run запускает Deploy того же SHA; фильтр `runs?name=Deploy`
  их не всегда различает. Жди завершения именно run'а workflow Deploy
  (запоминай его id при старте); сборка api+web на VPS идёт ~10–15 минут,
  `in_progress` всё это время — норма. Контейнер api при этом остаётся
  старым до конца (`docker ps` покажет прежний CreatedAt).** Если ран
  висит в `pending` — проверь, не держит ли concurrency-группу
  `deploy-staging` зависший прежний ран (отменить: POST
  `/actions/runs/{id}/cancel`).
- DNS стенда должен вести на VPS напрямую, без проксирования Cloudflare
  (иначе Let's Encrypt и WebSocket аукциона не работают). На 2026-11-12
  stage.suneclipse.ru резолвится в 188.120.225.204 напрямую.
- Бэкапы: cron `/etc/cron.d/dkp-guild-backup` — ежедневно в 03:17 локально
  в `/opt/dkp-guild-site/backups` (лог `/var/log/dkp-guild-backup.log`).
  По решению владельца #175 отдельный хостинг не используется: внешняя
  копия скачивается на Windows оператора (`scripts/pull-backups.ps1`),
  SHA-256 проверяется до ротации; последние 30 проверенных копий.
  `scripts/install-local-backup.ps1` ставит ежедневное задание 10:00 с
  StartWhenAvailable. Компьютер должен быть включён с доступом по SSH;
  BACKUP_REMOTE для push на другой сервер не требуется.
- Восстановление #175 проверено 2026-11-16: копия 20261116T145802Z,
  SHA eb67f2d3d1aa, 8 участников / 5 записей ДКП / 10 скриншотов,
  вход администратора и скачивание всех файлов; RTO 7,47 с для восстановления
  уже имеющейся копии и образа. Повторение на staging:
  `python3 scripts/verify-restore.py /opt/dkp-guild-site/backups/<timestamp>`.
  Скрипт создаёт internal network и временные контейнеры без портов,
  использует точный deployed image, не запускает миграции/seed и убирает
  только свои контейнеры. Целевой RPO — 24 часа при успешном ежедневном
  cron и скачивании; при выключенном ПК внешний RPO растёт до следующего
  успешного запуска. Полный RTO с потерей VPS и настройкой нового сервера
  этим тестом не измерен.

## Жизненный цикл задачи (поручение владельца 2026-11-09)

«Сделать задачу» — это полный цикл, а не только код:

1. Реализовать задачу с тестами (логика ядра — в `packages/shared`, юнит-тесты
   в том же PR; интеграционные с БД по приёмке).
2. Создать PR (зависимости от невлитых задач — базой на их ветку; после
   squash-мержа зависимости перебазировать на свежий `main`, иначе PR покажет
   чужой коммит и конфликты).
3. Дождаться зелёного CI по PR (проверить check runs именно финального коммита).
4. Влить PR в `main` (squash, заголовок с номерами задачи и PR).
5. Закрыть связанную задачу в GitHub Issues, оставив краткий комментарий:
   что влито (PR, squash-коммит), статус CI и покрытие приёмки.

Синхронизировать локальный `main` после вливания; чужие незакоммиченные
правки при ребейзе сохранять через stash и возвращать.

Практика цикла (подтверждено #96, 2026-11-10):

- Перед каждым коммитом сверяй `git branch --show-current`: в дереве
  параллельно работает вторая сессия владельца и может переключить его
  на `main`; ветка задачи обычно на одном коммите с `main`, так что
  `git switch` безопасен и уносит несмонтированные правки с собой.
- gh-CLI нет: GitHub — REST с токеном из `git credential fill`. Тела
  PR/issue/merge с кириллицей пиши файлом в `$TEMP` и передавай
  `--data-binary @file` — inline-JSON с кириллицей из Git Bash ломается.
  JSON удобно собрать python'ом в файл (без сети), отправку делать curl'ом:
  managed-python агента не проходит TLS к api.github.com
  (CERTIFICATE_VERIFY_FAILED, проверено 2026-11-16 на #203).
- Эффекты дочерних компонентов выполняются раньше родительских (урок #203):
  `mockResolvedValueOnce` в dashboard-тестах съедается первым запросом
  виджета недели, а не `/dashboard`. В тестах экранов с несколькими
  запросами используй path-моки (`mockImplementation` по пути).
- Скриншоты: `scripts/dev-screenshot.sh up` / `down` (2026-11-11, урок #101) —
  поднимает web `:3090` + API `:3005` на тест-БД `dkp_test`
  (`AUTH_TEST_MODE=true`, миграции + сид test-юзеров применяет сам),
  прокси `/api` в `next.config.ts` временно переключает на 3005 и откатывает
  при уборке/прерывании. Вход под игроком — `POST /auth/test-login` +
  `GET /auth/me` (без /me сессия без Member и прав); резервный админ —
  `POST /auth/admin/login` из `apps/api/.env`. Порт :3001 может занимать
  dev-API второй сессии — потому и :3005. Тестовые данные создавай через
  API и отменяй/чищи за собой; скриншот проверяй глазами ДО разбора стенда.
- **Батч фикстур** (урок #101): изменил обязательные поля общих типов shared —
  сразу чини все литералы в `*.spec`/`*.test` одним заходом (grep по типу),
  а не циклом typecheck-за-циклом. Код правь инструментом Edit, не inline
  node/sed-скриптами.
- Открытые issue и зависимости смотрите перед взятием задачи; порядок
  внутри этапа — по списку состава в issue приёмки этапа и зависимостям;
  задачи «согласовать с владельцем» без его решений не брать.

## Экономное делегирование

Предпочтение владельца: перед работой оцени пользу ограниченного независимого
подзадания. Тривиальные шаги и тесно связанную работу выполняй сам.
Для существенного простого поиска, разбора логов или точно заданной небольшой
правки используй `economy_worker` (gpt-6-luna, low), свежий контекст.
Не больше одного субагента одновременно и обычно одного на запрос;
для продолжения используй того же агента. Если основной агент — Luna,
обычно работай напрямую.

Давай только цель, нужные пути/выдержки, ограничения и критерии приёмки;
запрещай дальнейшее делегирование. При правках явно назначай файлы и предупреждай
о совместной работе, чтобы агент не отменял чужие изменения. Проси краткий итог
с доказательствами, изменёнными путями и выполненными проверками.
Не дублируй поиск агента: проверь результат и интеграцию.
Одна ограниченная попытка; архитектуру, неоднозначную отладку, безопасность
и интеграцию оставляй основному агенту. Это не жёсткий лимит бюджета.
