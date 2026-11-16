---
name: dkp-deploy-prod
description: Релизный деплой на прод suneclipse.ru из сессии — гейт-подтверждение владельца, проверка main/стейджа, создание и пуш тега vX.Y.Z, ожидание зелёного Release, запуск workflow Deploy (окружение production) с release_tag через GitHub API, контроль SHA в /api/health. Использовать, когда просят «задеплой на прод», «выкати релиз», «обнови production/продакшен», «выпусти версию vX.Y.Z» в репозитории dkp-guild-site.
---

# Деплой на production (suneclipse.ru)

Релизный цикл (README «Деплой через GitHub Actions»): main с зелёным CI →
стейдж проверен на этом SHA → тег `vX.Y.Z` на коммит из истории main →
зелёный workflow Release → ручной запуск Deploy с `release_tag` → контроль
SHA в health. Создание тега само по себе прод не обновляет; опубликованные
теги не передвигать.

Production живёт на том же VPS (188.120.225.204), checkout
`/opt/dkp-production`, проект `dkp-production`, SSH alias `dkp-stage`.
Деплои двух стендов сериализуются общим flock `/run/lock/dkp-deploy.lock`.

## Гейты — до любого запуска

1. Спроси номер версии (`vX.Y.Z`), если владелец не назвал; предложи
   следующий за последним тегом (`git tag --sort=-v:refname | tail -1`).
2. Деплой в прод — только после явного подтверждения владельца, что стейдж
   с этим SHA проверен. Без «да» не запускать.

## Порядок

1. Целевой SHA — head `origin/main` с зелёным CI. Проверка CI и токен — как в
   скилле dkp-deploy-stage (токен из `git credential fill`, только curl).
2. Проверь, что стейдж уже на этом SHA:

```bash
curl -s https://stage.suneclipse.ru/api/health
```

Если нет — сначала деплой на стейдж (dkp-deploy-stage) и гейт владельца.

3. Создай и запушь тег:

```bash
git fetch origin --tags
git tag -l 'vX.Y.Z'            # не должен существовать
git tag vX.Y.Z $(git rev-parse origin/main)
git push origin vX.Y.Z
```

Пуш тега `v*` запускает workflow Release (`.github/workflows/release.yml`):
сборка, миграции, тесты, установщик, публикация релиза и образов в GHCR.

4. Дождись зелёного Release для тега (у run `head_branch: "vX.Y.Z"`):

```bash
curl -s -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/MichaelCaineQA/dkp-guild-site/actions/workflows/release.yml/runs?per_page=5"
```

Опрашивай по id до `conclusion: success`. Release упал — прод не деплоим,
докладывай.

5. Запусти Deploy production (ref = `main`, тег — входом):

```bash
curl -s -X POST -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/MichaelCaineQA/dkp-guild-site/actions/workflows/deploy.yml/dispatches" \
  -d '{"ref":"main","inputs":{"environment":"production","release_tag":"vX.Y.Z"}}'
```

Workflow сам проверит до SSH: тег существует и указывает на коммит из
истории main (`scripts/select-production-tag.sh`), у SHA есть успешный CI.

6. Найди run (`event=workflow_dispatch`, создан после запуска), сохрани `id`
и опрашивай его раз в 1–2 минуты (ловушки ожидания — как в dkp-deploy-stage:
10–15 мин `in_progress` норма; `pending` — проверить concurrency
`deploy-production` и зависшие раны). В deploy-скрипте перед миграциями
автоматически делается снапшот БД и скриншотов.

7. Проверка результата:

```bash
curl -s https://suneclipse.ru/api/health
git rev-parse --short=12 vX.Y.Z^{commit}
```

Поле `sha` в health должно совпасть с коротким SHA коммита тега.

8. Доложи владельцу: версию, SHA, ссылки на run'ы Release и Deploy, результат
health. Предложи сверить свежесть бэкапа production перед следующим релизом.

## Диагностика при падении run

- Логи: `GET /actions/runs/<id>/jobs` → `GET /actions/jobs/<job_id>/logs`.
- При ошибке миграции API прода остаётся остановленным: не перезапускай молча.
  Диагностика и восстановление из снапшота — `ssh dkp-stage`,
  `/opt/dkp-production` (README «Production и stage на одном VPS»,
  «Резервные копии и восстановление»). Докладывай владельцу сразу.
