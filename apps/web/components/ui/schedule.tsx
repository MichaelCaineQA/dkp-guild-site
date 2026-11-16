import type { ReactNode } from 'react';
import type { WeekEvent } from '@dkp/shared';
import { Button } from './controls';
import { Badge } from './data';
export function ScheduleColumns({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div>{list}</div>
      <div>{detail}</div>
    </div>
  );
}
export function WeekEventButton({
  event,
  selected,
  onSelect,
  onDecline,
}: {
  event: WeekEvent;
  selected: boolean;
  onSelect: () => void;
  onDecline: () => void;
}) {
  const past = +new Date(event.endsAt) <= Date.now() || event.status === 'FINISHED';
  // Цветная полоса слева по статусу ивента (как на референсе расписания)
  const statusBar: Record<string, string> = {
    PLANNED: 'shadow-[inset_3px_0_0_0_var(--status-warning)]',
    RUNNING: 'shadow-[inset_3px_0_0_0_var(--accent-cyan)]',
    FINISHED: 'shadow-[inset_3px_0_0_0_var(--status-success)]',
    CANCELLED: 'shadow-[inset_3px_0_0_0_var(--text-muted)]',
  };
  const statusBadge: Record<string, 'success' | 'accent' | 'warning' | 'neutral'> = {
    PLANNED: 'warning',
    RUNNING: 'accent',
    FINISHED: 'success',
    CANCELLED: 'neutral',
  };
  const statusLabel: Record<string, string> = {
    PLANNED: 'Запланирован',
    RUNNING: 'Идёт',
    FINISHED: 'Завершён',
    CANCELLED: 'Отменён',
  };
  return (
    <div>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={`w-full rounded-xl border p-3 pl-4 text-left transition-all hover:border-line-accent hover:bg-surface-hover ${statusBar[event.status] ?? ''} ${selected ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-surface'} ${past ? 'opacity-60' : ''}`}
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-secondary">
            {new Date(event.startsAt).toLocaleString('ru-RU', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="flex items-center gap-1.5">
          <Badge tone={statusBadge[event.status] ?? 'neutral'}>
              {statusLabel[event.status] ?? event.status}
            </Badge>
            <Badge>{event.mode === 'PVE' ? 'PvE' : 'PvP'}</Badge>
          </span>
        </span>
        <span className="mt-1 block font-semibold">{event.name || event.eventTypeName}</span>
        <span className="mt-1 block text-sm text-secondary">
          РЛ: {event.raidLeadName} · {event.dkpReward} ДКП
        </span>
        <span className="mt-2 block text-sm">
          <span className="font-semibold text-accent tabular-nums">{event.attendingCount}</span>
          <span className="text-secondary">/{event.invitedCount} · пойдут / приглашены</span>
        </span>
      </button>
      {event.canDecline && (
        <Button className="mt-1" onClick={onDecline}>
          Не приду
        </Button>
      )}
    </div>
  );
}
