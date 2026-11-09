---
name: dkp-task
description: Полный цикл задачи в проекте dkp-guild-site — взять issue этапа, проверить знания по проекту, реализовать с тестами, запушить, открыть PR, дождаться CI, влить PR, закрыть задачу с кратким комментом. Использовать, когда просят «сделай задачу», «возьми следующую задачу этапа/этапа N», «закрой issue #N», «что дальше по плану — сделай» в репозитории dkp-guild-site — даже если просят только часть цикла, заканчивай его целиком, если не сказано иное.
---

# Задача по проекту dkp-guild-site

«Сделать задачу» = полный цикл до закрытого issue (поручение владельца,
зафиксировано в docs/agent-memory/workflow.md). Не останавливайся на
«код готов» — доведи до слитого PR и закрытой задачи.

## Чек-лист

1. [ ] Взять issue (ассайн, зависимости, занятость)
2. [ ] Обновить знания по проекту (PLAN.md + agent-memory)
3. [ ] Ветка + реализация с тестами
4. [ ] Проверки локально
5. [ ] PR + зелёный CI + squash-merge
6. [ ] Закрыть issue с комментом, убрать ветки, обновить память

## 1. Взять issue

- Открытые issue: GitHub API (`gh`-CLI нет):
  `curl -s -H "Authorization: token $TOKEN" .../issues?state=open` с токеном
  из `git credential fill` (см. «GitHub через API» ниже).
- Выбор: milestone = этап плана; порядок внутри этапа — по списку состава
  в issue приёмки этапа и зависимостям («Зависит от #N»). Заблокированную
  задачу не брать; задачи с «согласовать с владельцем» (типа #101) — не брать
  без его решений.
- Занятость: если у issue есть assignee не ты — не брать, спросить владельца.
- Ассайн на себя: `POST /issues/N/assignees {"assignees":["<git user>"]}`.

## 2. Знания по проекту (обязательно перед кодом)

- `docs/PLAN.md` — единственный источник требований и игровых правил.
  Противоречия решает план; менять его без явной просьбы владельца нельзя.
- `docs/agent-memory/architecture.md` — карта модулей и обязательные
  ограничения (append-only журнал ДКП, настройки не константами, аудит
  ручных действий, приватность на сервере, UI только русский).
- `docs/agent-memory/workflow.md` — команды, проверки, жизненный цикл,
  делегирование; `known-issues.md` — ловушки окружения.
- Для UI: `docs/ui/` (представление экранов) и `apps/web/DESIGN.md`
  (палитра и примитивы).

## 3. Ветка и реализация

- Ветка `feature/<issue>-<slug>` (или `fix/`, `docs/`) от свежего `main`.
- **Перед каждым коммитом — `git branch --show-current`**: в дереве
  параллельно работает вторая сессия и может переключить его на `main`;
  несмонтированные правки при switch между ветками на одном коммите
  сохраняются.
- Конвенции, проверенные предыдущими задачами:
  - логика ядра — в `packages/shared` (zod-схемы + чистые функции),
    юнит-тесты в том же PR (`packages/shared/src/*.test.ts`);
  - сервисы API — с минимальным интерфейсом БД для юнит-тестов без Prisma
    (образец: `apps/api/src/bids/bids.service.ts`); гонки — сериализуемые
    транзакции через `serializable()` с перечитыванием статуса;
  - каждый новый эндпоинт обязан иметь контракт в
    `apps/api/src/openapi/contracts.ts` (+ схемы входа/ответа) — иначе
    падает `openapi.spec.ts`;
  - ручные действия пишут `AuditLog` с автором и обязательной причиной;
    финансовые записи — идемпотентные ключи `DkpEntry.requestId`;
  - UI — примитивы `apps/web/components/ui`, стили страницам не писать;
    после правок UI — скриншоты desktop+mobile в `docs/screenshots/`.

## 4. Проверки локально

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
# интеграционные на реальной PostgreSQL (docker compose up -d):
ONBOARDING_TEST_DATABASE_URL=postgresql://dkp:dkp@127.0.0.1:5432/dkp_test?schema=public \
  pnpm -C apps/api exec jest --runInBand --testPathPattern=database.spec.ts
```

- `dkp_test` общая для всех database-спек: убирай свои ряды в `afterAll`
  (FK-безопасный порядок, образец — `auction-manage.database.spec.ts`);
  не оставляй просроченных OPEN-лотов — они ломают чужие тесты свипера.
- Скриншоты: web `:3090` + API `:3001` (прокси `/api` зашит на 3001),
  API с `WEB_URL=http://localhost:3090`; вход — резервный админ из
  `apps/api/.env` через `POST /auth/admin/login` (test-login даёт сессию
  без прав). Тестовые данные создать через API и убрать из dev-БД.

## 5. PR и CI

GitHub через API (см. workflow.md):

```bash
TOKEN=$(printf 'protocol=https\nhost=github.com\n' | git credential fill \
  | grep '^password=' | cut -d= -f2)
```

- Тела с кириллицей — файлом в `$TEMP` + `--data-binary @file`
  (inline-JSON из Git Bash ломается).
- PR: заголовок `тип: суть (#issue)`, тело — что сделано, правила плана,
  тесты, скриншоты относительными путями.
- CI: опрос `GET /repos/.../commits/<sha>/check-runs` финального коммта
  до `completed/success` (обычно 2–4 мин).
- Merge: `PUT /pulls/N/merge`, squash, заголовок `тип: суть (#issue) (#PR)`.

## 6. Финал

- Закрыть issue: `PATCH /issues/N {"state":"closed","state_reason":"completed"}`
  + короткий комментарий: что влито (PR, squash-коммит), статус CI,
  покрытие приёмки.
- `git switch main && git pull --ff-only`, удалить ветку локально и на
  origin, `git fetch --prune` (на origin держим только `main`).
- Попутные дефекты — отдельные issue, не чинить молча в чужом PR.
- Обновить `docs/agent-memory/*` при изменившихся фактах (карта модулей,
  ловушки) — тем же циклом через маленький docs-PR.
