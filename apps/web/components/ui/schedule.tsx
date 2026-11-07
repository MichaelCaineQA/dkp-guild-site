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
  return (
    <div>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={`w-full rounded-card border p-3 text-left hover:bg-surface-muted ${selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface'} ${past ? 'opacity-60' : ''}`}
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
          <Badge>{event.mode === 'PVE' ? 'PvE' : 'PvP'}</Badge>
        </span>
        <span className="mt-1 block font-semibold">{event.name || event.eventTypeName}</span>
        <span className="mt-1 block text-sm text-secondary">
          РЛ: {event.raidLeadName} · {event.dkpReward} ДКП
        </span>
        <span className="mt-2 block text-sm">
          {event.attendingCount}/{event.invitedCount} · пойдут / приглашены
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
