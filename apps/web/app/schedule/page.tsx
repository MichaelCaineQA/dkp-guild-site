'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EVENT_MODES,
  can,
  canManageEvent,
  getLocalWeekBounds,
  localDayKey,
  splitIntoPhaseSegments,
  type DashboardEvent as EventRow,
  type WeekEvent,
  type EventMode,
  type GamePhaseConfig,
} from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import { EventCard } from '../../components/event-card';
import { CreateEventDialog } from '../../components/create-event-dialog';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Muted,
  Page,
  PageHeader,
  Select,
  ScheduleColumns,
  WeekEventButton,
} from '../../components/ui';
interface EventTypeRow {
  id: string;
  name: string;
}
const MODE_LABELS: Record<EventMode, string> = { PVE: 'PvE', PVP: 'PvP' };
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export default function SchedulePage() {
  const { user, loading: sessionLoading } = useSession();
  const [view, setView] = useState<'week' | 'calendar'>('week');
  const [events, setEvents] = useState<EventRow[]>([]);
  const [weekEvents, setWeekEvents] = useState<WeekEvent[]>([]);
  const [eventTypes, setEventTypes] = useState<EventTypeRow[]>([]);
  const [gameTime, setGameTime] = useState<GamePhaseConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdMessage, setCreatedMessage] = useState('');
  const [weekCursor, setWeekCursor] = useState(() => getLocalWeekBounds(new Date()).start);
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [typeFilter, setTypeFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const generation = useRef(0);
  const canManage = !!user && can(user, 'events.manage');
  const load = useCallback(async () => {
    const request = ++generation.current;
    setPending(true);
    setError(null);
    const week = getLocalWeekBounds(weekCursor);
    const from =
      view === 'week'
        ? week.start
        : new Date(monthCursor.getFullYear(), monthCursor.getMonth(), -6);
    const to =
      view === 'week'
        ? week.end
        : new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 14);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (typeFilter) params.set('eventTypeId', typeFilter);
    if (modeFilter) params.set('mode', modeFilter);
    try {
      const [data, types, time] = await Promise.all([
        api<WeekEvent[] | EventRow[]>(
          `${view === 'week' ? '/schedule/week' : '/events'}?${params}`,
        ),
        api<EventTypeRow[]>('/event-types'),
        api<{ gameTimeAnchor: string; gameTimeDayMinutes: number; gameTimeNightMinutes: number }>(
          '/settings/game-time',
        ),
      ]);
      if (request !== generation.current) return;
      setEvents(data);
      setWeekEvents(view === 'week' ? (data as WeekEvent[]) : []);
      setEventTypes(types);
      setGameTime({
        anchor: new Date(time.gameTimeAnchor),
        dayMinutes: time.gameTimeDayMinutes,
        nightMinutes: time.gameTimeNightMinutes,
      });
    } catch {
      if (request === generation.current) {
        setError('Не удалось загрузить расписание');
        setEvents([]);
        setWeekEvents([]);
      }
    } finally {
      if (request === generation.current) setPending(false);
    }
  }, [view, weekCursor, monthCursor, typeFilter, modeFilter]);
  useEffect(() => {
    if (!sessionLoading && (user?.memberId || user?.isAdmin)) void load();
    return () => {
      generation.current++;
    };
  }, [sessionLoading, user, load]);
  const selected = events.find((event) => event.id === selectedId);
  if (sessionLoading) return <Page>Загрузка…</Page>;
  if (!user)
    return (
      <Page>
        <PageHeader title="Расписание" subtitle="Раздел доступен членам гильдии после входа." />
      </Page>
    );
  if (!user.memberId && !user.isAdmin)
    return (
      <Page>
        <PageHeader
          title="Расписание"
          subtitle="Ваш аккаунт ещё не привязан к члену гильдии — отправьте заявку на привязку ника."
        />
      </Page>
    );
  const week = getLocalWeekBounds(weekCursor);
  const lastDay = new Date(week.end);
  lastDay.setDate(lastDay.getDate() - 1);
  const detail =
    selected && !pending ? (
      <EventCard
        key={selected.id}
        event={selected}
        gameTime={gameTime}
        presentation={view === 'week' ? 'panel' : 'dialog'}
        canManage={canManageEvent(user, selected)}
        canConduct={can(user, 'events.conduct', selected)}
        onClose={() => setSelectedId(null)}
        onChanged={load}
      />
    ) : null;
  return (
    <Page width="wide">
      <PageHeader title="Расписание ивентов" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Вид расписания" className="flex gap-2">
          <Button
            aria-pressed={view === 'week'}
            variant={view === 'week' ? 'primary' : undefined}
            onClick={() => {
              setView('week');
              setSelectedId(null);
            }}
          >
            События
          </Button>
          <Button
            aria-pressed={view === 'calendar'}
            variant={view === 'calendar' ? 'primary' : undefined}
            onClick={() => {
              setView('calendar');
              setSelectedId(null);
            }}
          >
            Календарь
          </Button>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Создать ивент
          </Button>
        )}
      </div>
      {createdMessage && <p role="status">{createdMessage}</p>}
      {canManage && creating && (
        <CreateEventDialog
          onClose={() => setCreating(false)}
          onCreated={(date, message) => {
            setCreating(false);
            setCreatedMessage(message);
            setTypeFilter('');
            setModeFilter('');
            setSelectedId(null);
            setWeekCursor(getLocalWeekBounds(date).start);
            setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1));
          }}
        />
      )}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              aria-label={view === 'week' ? 'Предыдущая неделя' : 'Предыдущий месяц'}
              onClick={() => shift(-1)}
            >
              ←
            </Button>
            <span className="font-semibold">
              {view === 'week'
                ? `${week.start.toLocaleDateString('ru-RU')} — ${lastDay.toLocaleDateString('ru-RU')}`
                : monthCursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
            </span>
            <Button
              aria-label={view === 'week' ? 'Следующая неделя' : 'Следующий месяц'}
              onClick={() => shift(1)}
            >
              →
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Field label="Тип:">
              <Select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setSelectedId(null);
                }}
              >
                <option value="">все</option>
                {eventTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Режим:">
              <Select
                value={modeFilter}
                onChange={(e) => {
                  setModeFilter(e.target.value);
                  setSelectedId(null);
                }}
              >
                <option value="">все</option>
                {EVENT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {MODE_LABELS[mode]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Card>
      {error && <ErrorText>{error}</ErrorText>}
      {pending && <p role="status">Загрузка расписания…</p>}
      {!pending &&
        !error &&
        (view === 'week' ? (
          <ScheduleColumns
            list={
              <Card>
                {weekEvents.length === 0 && <Muted>На этой неделе событий нет</Muted>}
                <ul className="flex flex-col gap-2">
                  {weekEvents.map((event) => (
                    <li key={event.id}>
                      <WeekEventButton
                        event={event}
                        selected={selectedId === event.id}
                        onSelect={() => setSelectedId(event.id)}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            }
            detail={
              detail ?? (
                <Card>
                  <Muted>Выберите событие из списка</Muted>
                </Card>
              )
            }
          />
        ) : (
          <Card>
            <Legend />
            <MonthGrid
              monthCursor={monthCursor}
              events={events}
              gameTime={gameTime}
              onSelect={(event) => setSelectedId(event.id)}
            />
          </Card>
        ))}
      {view === 'calendar' && detail}
    </Page>
  );
  function shift(delta: number) {
    setSelectedId(null);
    if (view === 'week')
      setWeekCursor((prev) => {
        const next = new Date(prev);
        next.setDate(next.getDate() + delta * 7);
        return next;
      });
    else setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }
}

/** Легенда раскраски фаз (план 2.1). */
function Legend() {
  return (
    <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-secondary">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-5 rounded-sm bg-[#f5c84c]" /> день в игре
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-5 rounded-sm bg-[#3b4a6b]" /> ночь в игре
      </span>
      <span>Полоска ивента разбита по фазам игрового цикла</span>
    </p>
  );
}

/** Сетка месяца: дни × строки-ивенты с полосками фаз день/ночь. */
function MonthGrid({
  monthCursor,
  events,
  gameTime,
  onSelect,
}: {
  monthCursor: Date;
  events: EventRow[];
  gameTime: GamePhaseConfig | null;
  onSelect: (event: EventRow) => void;
}) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const days = useMemo(() => {
    const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    // Начинаем с понедельника
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from(
      { length: 42 },
      (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    );
  }, [monthCursor]);

  return (
    <div className="mt-3 grid grid-cols-7 gap-1 text-sm">
      {WEEKDAYS.map((day) => (
        <div key={day} className="pb-1 text-center text-xs font-semibold text-secondary">
          {day}
        </div>
      ))}
      {days.map((day) => {
        const dayEvents = events.filter(
          (event) => localDayKey(new Date(event.startsAt)) === localDayKey(day),
        );
        const inMonth = day.getMonth() === monthCursor.getMonth();
        const isToday = localDayKey(day) === localDayKey(new Date());
        return (
          <div
            key={day.toISOString()}
            className={`min-h-24 rounded-lg border p-1 ${
              inMonth ? 'border-line bg-surface' : 'border-line/40 bg-surface-muted/40'
            } ${isToday ? 'ring-1 ring-accent' : ''}`}
          >
            <div className={`text-right text-xs ${inMonth ? 'text-secondary' : 'text-disabled'}`}>
              {day.getDate()}
            </div>
            <div className="flex flex-col gap-0.5">
              {(expandedDay === localDayKey(day) ? dayEvents : dayEvents.slice(0, 4)).map(
                (event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onSelect(event)}
                    className={`w-full text-left ${+new Date(event.endsAt) <= Date.now() || event.status === 'FINISHED' ? 'opacity-60' : ''}`}
                    title={`${event.name || event.eventTypeName} · ${new Date(event.startsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · РЛ ${event.raidLeadName}`}
                  >
                    <EventPhaseBar event={event} gameTime={gameTime} />
                  </button>
                ),
              )}
              {dayEvents.length > 4 && expandedDay !== localDayKey(day) && (
                <button
                  type="button"
                  className="text-left text-xs text-accent"
                  onClick={() => setExpandedDay(localDayKey(day))}
                >
                  +{dayEvents.length - 4}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Полоска ивента, раскрашенная по фазам игрового времени (план 2.1):
 * ивент, накрывающий несколько фаз, сегментирован.
 */
function EventPhaseBar({ event, gameTime }: { event: EventRow; gameTime: GamePhaseConfig | null }) {
  const startsAt = new Date(event.startsAt);
  const label = `${startsAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} ${event.name || event.eventTypeName}`;

  if (!gameTime) {
    return (
      <span className="block truncate rounded-sm bg-accent-soft px-1 text-[11px] leading-5 text-primary">
        {label}
      </span>
    );
  }

  const segments = splitIntoPhaseSegments(startsAt, new Date(event.endsAt), gameTime);
  const totalMs =
    startsAt.getTime() > 0 ? new Date(event.endsAt).getTime() - startsAt.getTime() : 1;

  return (
    <span
      className="relative flex h-5 w-full overflow-hidden rounded-sm border border-line"
      title={label}
    >
      <span className="absolute inset-0 z-10 truncate px-1 text-[11px] leading-5 text-white [text-shadow:0_1px_2px_#000]">
        {label}
      </span>
      {segments.map((segment, index) => (
        <span
          key={index}
          style={{
            width: `${Math.max(8, ((segment.endsAt.getTime() - segment.startsAt.getTime()) / totalMs) * 100)}%`,
          }}
          className={`block h-full ${segment.phase === 'DAY' ? 'bg-[#f5c84c]' : 'bg-[#3b4a6b]'}`}
        />
      ))}
    </span>
  );
}
