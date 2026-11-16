import type { ReactNode } from 'react';
import type { WeekEvent } from '@dkp/shared';
import { formatEventTimeRange } from '@dkp/shared';
import { Button } from './controls';
import { Badge } from './data';
import type { DashboardEvent } from '@dkp/shared';
export function MobileCalendarList({
  events,
  onSelect,
}: {
  events: DashboardEvent[];
  onSelect: (event: DashboardEvent) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2 sm:hidden" aria-label="События месяца">
      {events.length === 0 && <p>В этом месяце нет событий.</p>}
      {[...events]
        .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
        .map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelect(event)}
            className={`w-full rounded-lg border border-line bg-surface p-3 text-left ${+new Date(event.endsAt) <= Date.now() || event.status === 'FINISHED' ? 'opacity-60' : ''}`}
          >
            <span className="block text-xs text-secondary">
              {new Date(event.startsAt).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="block break-words font-medium">
              {event.name || event.eventTypeName}
            </span>
            <span className="block text-xs text-secondary">РЛ: {event.raidLeadName}</span>
          </button>
        ))}
    </div>
  );
}
export function ScheduleColumns({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="min-w-0">{list}</div>
      <div className="min-w-0">{detail}</div>
    </div>
  );
}
/**
 * Сетка недельного расписания дашборда (issue #203): на компьютере семь
 * колонок пн–вс, на телефоне дневные блоки идут одной колонкой.
 */
export function WeekScheduleGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-2 md:grid-cols-7">{children}</div>;
}
/** Колонка одного дня недели; текущий день выделен рамкой акцентного цвета. */
export function WeekScheduleDay({
  header,
  today,
  children,
}: {
  header: string;
  today: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={header}
      className={`flex min-w-0 flex-col gap-2 rounded-lg border p-2 ${
        today ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface'
      }`}
    >
      <h3 className={`text-sm font-semibold ${today ? 'text-accent' : 'text-secondary'}`}>
        {header}
      </h3>
      {children}
    </div>
  );
}
/**
 * Плитка события недельного расписания (issue #203): только название,
 * интервал времени и плата ДКП; прошедшие приглушены.
 */
export function WeekScheduleEventButton({
  event,
  past,
  onClick,
}: {
  event: DashboardEvent;
  past: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-left hover:bg-surface-muted ${
        past ? 'opacity-50' : ''
      }`}
    >
      <span className="block break-words text-sm font-medium">
        {event.name || event.eventTypeName}
      </span>
      <span className="block text-xs text-secondary tabular-nums">
        {formatEventTimeRange(event.startsAt, event.endsAt)}
      </span>
      <span className="block text-xs tabular-nums">{event.dkpReward} ДКП</span>
    </button>
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
