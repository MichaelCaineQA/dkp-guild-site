# Как мы работаем

## Ветки и PR

- `main` — основная ветка. Разработка — в ветках `feature/<тема>` (или
  `fix/`, `chore/`), затем Pull Request в `main`.
- **Ревью опционально:** разработчикам верим на слово. Обязательное условие
  вливания — зелёный CI (lint + typecheck + test + build). Если нужно мнение
  со стороны (сложная логика, ядро ДКП) — позови ревьюера в PR, это не блокер.
- PR оформляем по шаблону: что сделано / зачем / как проверить / скриншоты
  (если UI).
- Перед пушем прогони локально: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Соглашения кода

- TypeScript strict, единый prettier (`pnpm format`).
- Всё, что относится к правилам гильдии (размеры плат, наценки, окна) — через
  модель `Setting`, не константами в коде (docs/PLAN.md, раздел 5).
- Логика журнала ДКП, прав и игрового времени живёт в `packages/shared` и
  покрывается юнит-тестами в том же PR.
- Любые ручные действия (отметки посещения, назначения победителя аукциона)
  обязаны писать запись в `AuditLog` (docs/PLAN.md, раздел 2.9).

## Окружение

- Node.js ≥ 20, pnpm (`corepack enable`), Docker (PostgreSQL + Redis:
  `docker compose up -d`).
- Секреты не коммитим: всё через `.env` (образец — `.env.example`).
- **TODO (первый контрибьютор с git-доступом):** закоммитить `pnpm-lock.yaml`
  (`pnpm install && git add pnpm-lock.yaml && git commit && git push`) и
  вернуть `--frozen-lockfile` в `.github/workflows/ci.yml`.
