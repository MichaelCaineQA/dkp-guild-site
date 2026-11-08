import { Button } from './controls';
import { ErrorText, Muted } from './layout';
export interface EventAbsenceRow {
  id: string;
  memberId: string;
  memberName: string;
  reason: string | null;
  seenBy: string[];
}
export function EventAbsences({
  rows,
  actorKey,
  canSee,
  busyId,
  error,
  onSeen,
}: {
  rows: EventAbsenceRow[];
  actorKey: string | null;
  canSee: boolean;
  busyId: string | null;
  error: string;
  onSeen: (id: string) => void;
}) {
  return (
    <section className="mt-3 rounded-lg border border-warning/40 bg-warning-soft p-3">
      <p className="text-xs font-semibold text-warning">
        Отсутствуют по уважительной ({new Set(rows.map((r) => r.memberId)).size}) — не отмечаются
        вручную:
      </p>
      {error && (
        <div role="alert">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <ul className="mt-2 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <span className="font-medium">{row.memberName}</span>
              <span className="text-secondary">
                {' '}
                — {row.reason === null ? 'Причина скрыта' : row.reason || 'Без причины'}
              </span>
              {row.seenBy.length > 0 && <Muted> · Просмотрели: {row.seenBy.length}</Muted>}
            </div>
            {canSee && actorKey && (
              <Button
                disabled={busyId !== null || row.seenBy.includes(actorKey)}
                onClick={() => onSeen(row.id)}
              >
                {row.seenBy.includes(actorKey)
                  ? '✓ Увидено'
                  : busyId === row.id
                    ? 'Сохранение…'
                    : 'Увидел'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
