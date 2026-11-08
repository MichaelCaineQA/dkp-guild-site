import type { AuditRow } from '@dkp/shared';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@dkp/shared';
export function AuditFeed({ entries }: { entries: AuditRow[] }) {
  return (
    <ol aria-label="Записи журнала" className="divide-y divide-line">
      {entries.map((entry) => (
        <li key={entry.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="font-semibold">{entry.actorName ?? 'Система'}</span>
            <time dateTime={entry.createdAt} className="text-xs text-secondary">
              {new Date(entry.createdAt).toLocaleString('ru-RU')}
            </time>
          </div>
          <p className="mt-1">
            {AUDIT_ACTION_LABELS[entry.action] ?? 'Другое действие'}{' '}
            <span className="text-secondary">
              · {AUDIT_ENTITY_LABELS[entry.entityType] ?? 'Объект'}:{' '}
              <span className="break-words">
                {entry.entityName ??
                  (entry.entityType === 'Member' ? 'Участник недоступен' : entry.entityId || '—')}
              </span>
            </span>
          </p>
          {entry.comment && (
            <p className="mt-1 break-words text-sm text-secondary">Комментарий: {entry.comment}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
