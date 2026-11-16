---
name: dkp-deploy-stage
description: Деплой main на стенд stage.suneclipse.ru из сессии — проверка зелёного CI целевого SHA, ожидание авто-деплоя или ручной запуск workflow Deploy (окружение staging) через GitHub API, контроль SHA в /api/health. Использовать, когда просят «задеплой на стейдж», «выкати на stage», «обнови стейдж/стенд», «залей main на стейдж» в репозитории dkp-guild-site.
---

# Деплой на stage (stage.suneclipse.ru)

Механика: workflow `Deploy` (`.github/workflows/deploy.yml`) заливает выбранный
SHA через `git archive` по SSH на VPS 188.120.225.204 в `/opt/dkp-guild-site`
и запускает `scripts/deploy-prod.sh` (сборка образов ~10–15 мин, снапшот БД,
миграции, запуск, браузерный smoke). Прямой ручной SSH-деплой не используем:
только workflow, он проверяет успешный CI и гоняет smoke. Подробности стенда —
`docs/agent-memory/workflow.md`, раздел «Стенд stage.suneclipse.ru».

## Порядок

1. Целевой SHA — по умолчанию head `origin/main`:

```bash
git fetch origin
SHA=$(git rev-parse origin/main)
```

2. Проверь зелёный CI этого SHA — обязательное условие самого workflow Deploy
(шаг «Require successful CI»). gh-CLI нет — GitHub REST через curl (managed
python не проходит TLS к api.github.com):

```bash
TOKEN=$(printf 'protocol=https\nhost=github.com\n' | git credential fill \
  | grep '^password=' | cut -d= -f2)
REPO=MichaelCaineQA/dkp-guild-site
curl -s -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&status=success&per_page=1"
```

Нет успешного run — дождись CI или доложи и остановись.

3. Автодеплой: успешный CI пуша в `main` сам запускает Deploy того же SHA
(workflow_run). Сначала посмотри, не идёт ли уже подходящий run:

```bash
curl -s -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$REPO/actions/workflows/deploy.yml/runs?per_page=10"
```

Ищи run с `head_sha=$SHA`: `event=workflow_run` — авто-деплой после CI,
`event=workflow_dispatch` — ручной. Если он `queued`/`in_progress` — просто жди
его, новый не запускай (concurrency-группа `deploy-staging` и серверный flock
`/run/lock/dkp-deploy.lock` и так сериализуют).

4. Подходящего run нет или он завершился неуспехом — запусти вручную:

```bash
curl -s -X POST -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/actions/workflows/deploy.yml/dispatches" \
  -d '{"ref":"main","inputs":{"environment":"staging"}}'
```

Через пару секунд найди новый run (`event=workflow_dispatch`, создан после
запуска) и **сохрани его `id`** — дальше опрашивай только его (ловушка #172:
фильтр по имени не различает раны разных триггеров):

```bash
curl -s -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/$REPO/actions/runs/<id>"
```

Опрашивай раз в 1–2 минуты. `in_progress` 10–15 минут — норма: сборка api+web
на VPS, контейнер api всё это время старый. Долго висит `queued`/`pending` —
проверь, не держит ли concurrency-группу зависший прежний ран; отмена:
`POST /actions/runs/<id>/cancel`. Подозрение на наложение с ежедневным бэкапом
(~03:17 по серверу, тот же flock) — проверь на сервере.

5. Проверка результата: у run `conclusion: success`, затем SHA на стенде:

```bash
curl -s https://stage.suneclipse.ru/api/health
```

Поле `sha` (12 символов) должно совпадать с целевым SHA
(`git rev-parse --short=12 $SHA`).

6. Доложи владельцу: задеплоенный SHA, ссылку на run, результат health.

## Диагностика при падении run

- Логи шагов: `GET /actions/runs/<id>/jobs` → `GET /actions/jobs/<job_id>/logs`.
- Сервер: `ssh dkp-stage` (ключ `~/.ssh/dkp_stage`), checkout
  `/opt/dkp-guild-site`; `docker compose --env-file .env.production
  -f docker-compose.prod.yml ps` и `logs`. При ошибке миграции API остаётся
  остановленным до проверки/восстановления — не «чинить» молча, докладывай.
