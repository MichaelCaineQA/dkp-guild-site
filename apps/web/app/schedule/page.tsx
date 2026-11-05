'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EVENT_MODES,
  RANK_LABELS,
  can,
  splitIntoPhaseSegments,
  type EventMode,
  type GamePhaseConfig,
} from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import { CheckInPanel, RaidLeadCodePanel } from '../../components/checkin-panels';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Muted,
  Page,
  PageHeader,
  Select,
  SectionTitle,
} from '../../components/ui';

interface EventRow {
  id: string;
  eventTypeId: string;
  eventTypeName: string;
  mode: EventMode;
  status: string;
  startsAt: string;
  endsAt: string;
  dkpReward: number;
  raidLeadId: string;
  raidLeadName: string;
  place: string | null;
  notes: string | null;
}

interface EventTypeRow {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Запланирован',
  RUNNING: 'Идёт',
  FINISHED: 'Завершён',
  CANCELLED: 'Отменён',
};

const MODE_LABELS: Record<EventMode, string> = { PVE: 'PvE', PVP: 'PvP' };
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Расписание (issue #8): календарь с игровыми фазами + список ближайших. */
export default function SchedulePage() {
  const { user, loading: sessionLoading } = useSession();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventTypes, setEventTypes] = useState<EventTypeRow[]>([]);
  const [gameTime, setGameTime] = useState<GamePhaseConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EventRow | null>(null);

  // Месяц календаря: первый день просматриваемого месяца.
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const [typeFilter, setTypeFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');

  const canManage = useMemo(
    () =>
      user && can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'events.manage'),
    [user],
  );

  const load = useCallback(async () => {
    const from = new Date(monthCursor.getTime() - 7 * 24 * 60 * 60 * 1000);
    const to = new Date(monthCursor.getTime() + 45 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (typeFilter) {
      params.set('eventTypeId', typeFilter);
    }
    if (modeFilter) {
      params.set('mode', modeFilter);
    }
    try {
      const [eventsData, typesData, gameTimeData] = await Promise.all([
        api<EventRow[]>(`/events?${params.toString()}`),
        api<EventTypeRow[]>('/event-types'),
        api<{ gameTimeAnchor: string; gameTimeDayMinutes: number; gameTimeNightMinutes: number }>(
          '/settings/game-time',
        ),
      ]);
      setEvents(eventsData);
      setEventTypes(typesData);
      setGameTime({
        anchor: new Date(gameTimeData.gameTimeAnchor),
        dayMinutes: gameTimeData.gameTimeDayMinutes,
        nightMinutes: gameTimeData.gameTimeNightMinutes,
      });
      setError(null);
    } catch {
      setError('Не удалось загрузить расписание');
    }
  }, [monthCursor, typeFilter, modeFilter]);

  useEffect(() => {
    if (!sessionLoading && user?.memberId) {
      void load();
    }
  }, [sessionLoading, user, load]);

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return (
      <Page>
        <PageHeader title="Расписание" subtitle="Раздел доступен членам гильдии после входа." />
      </Page>
    );
  }

  if (!user.memberId && !user.isAdmin) {
    return (
      <Page>
        <PageHeader
          title="Расписание"
          subtitle="Ваш аккаунт ещё не привязан к члену гильдии — отправьте заявку на привязку ника."
        />
      </Page>
    );
  }

  const upcoming = events
    .filter((event) => new Date(event.startsAt).getTime() >= Date.now() - 2 * 60 * 60 * 1000)
    .slice(0, 10);

  return (
    <Page width="wide">
      <PageHeader title="Расписание ивентов" />
      {error && <ErrorText>{error}</ErrorText>}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button onClick={() => shiftMonth(-1)}>←</Button>
            <span className="text-lg font-semibold">
              {monthCursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </span>
            <Button onClick={() => shiftMonth(1)}>→</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Field label="Тип:">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">все</option>
                {eventTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Режим:">
              <Select value={modeFilter} onChange={(e) => setModeFilter(e.target.value as EventMode | '')}>
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
        <Legend />
        <MonthGrid
          monthCursor={monthCursor}
          events={events}
          gameTime={gameTime}
          onSelect={setSelected}
        />
      </Card>

      <Card>
        <SectionTitle>Ближайшие ивенты</SectionTitle>
        {upcoming.length === 0 && <Muted>Ближайших ивентов нет</Muted>}
        <ul className="flex flex-col gap-2">
          {upcoming.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                className="w-full rounded-card border border-line bg-surface px-3 py-2 text-left hover:bg-surface-muted"
                onClick={() => setSelected(event)}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{event.eventTypeName}</Badge>
                  <Badge>{MODE_LABELS[event.mode]}</Badge>
                  <span className="text-sm font-medium">
                    {new Date(event.startsAt).toLocaleString('ru-RU', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <Muted>РЛ: {event.raidLeadName} · {event.dkpReward} ДКП</Muted>
                  {event.status !== 'PLANNED' && (
                    <Badge tone={event.status === 'RUNNING' ? 'success' : 'warning'}>
                      {STATUS_LABELS[event.status]}
                    </Badge>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {selected && (
        <EventCard
          event={selected}
          gameTime={gameTime}
          canManage={!!canManage}
          isRl={user.memberId === selected.raidLeadId}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}

      <div className="mt-4" />
      {canManage && <Muted>Создание ивентов и серий — отдельный экран создания (скоро)</Muted>}
    </Page>
  );

  function shiftMonth(delta: number) {
    setMonthCursor((prev) => new Date(prev.getUTCFullYear(), prev.getUTCMonth() + delta, 1));
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
  const days = useMemo(() => {
    const first = new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth(), 1));
    // Начинаем с понедельника
    const offset = (first.getUTCDay() + 6) % 7;
    const start = new Date(first.getTime() - offset * 24 * 60 * 60 * 1000);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 24 * 60 * 60 * 1000));
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
          (event) =>
            new Date(event.startsAt).toISOString().slice(0, 10) === day.toISOString().slice(0, 10),
        );
        const inMonth = day.getUTCMonth() === monthCursor.getUTCMonth();
        const isToday = day.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
        return (
          <div
            key={day.toISOString()}
            className={`min-h-24 rounded-lg border p-1 ${
              inMonth ? 'border-line bg-surface' : 'border-line/40 bg-surface-muted/40'
            } ${isToday ? 'ring-1 ring-accent' : ''}`}
          >
            <div className={`text-right text-xs ${inMonth ? 'text-secondary' : 'text-disabled'}`}>
              {day.getUTCDate()}
            </div>
            <div className="flex flex-col gap-0.5">
              {dayEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onSelect(event)}
                  className="w-full text-left"
                  title={`${event.eventTypeName} · ${new Date(event.startsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · РЛ ${event.raidLeadName}`}
                >
                  <EventPhaseBar event={event} gameTime={gameTime} />
                </button>
              ))}
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
  const label = `${startsAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} ${event.eventTypeName}`;

  if (!gameTime) {
    return (
      <span className="block truncate rounded-sm bg-accent-soft px-1 text-[11px] leading-5 text-primary">
        {label}
      </span>
    );
  }

  const segments = splitIntoPhaseSegments(startsAt, new Date(event.endsAt), gameTime);
  const totalMs = startsAt.getTime() > 0 ? new Date(event.endsAt).getTime() - startsAt.getTime() : 1;

  return (
    <span
      className="flex h-5 w-full overflow-hidden rounded-sm border border-line"
      title={label}
    >
      {segments.map((segment, index) => (
        <span
          key={index}
          style={{ width: `${Math.max(8, ((segment.endsAt.getTime() - segment.startsAt.getTime()) / totalMs) * 100)}%` }}
          className={`block h-full ${
            segment.phase === 'DAY' ? 'bg-[#f5c84c]' : 'bg-[#3b4a6b]'
          }`}
        />
      ))}
    </span>
  );
}

/** Карточка ивента: шкала фаз на его длительность, детали, статусы. */
function EventCard({
  event,
  gameTime,
  canManage,
  isRl,
  onClose,
  onChanged,
}: {
  event: EventRow;
  gameTime: GamePhaseConfig | null;
  canManage: boolean;
  isRl: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const changeStatus = async (status: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/events/${event.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      setMessage('Статус изменён');
      onChanged();
      onClose();
    } catch (err) {
      const httpStatus = (err as { status?: number }).status;
      setMessage(httpStatus === 409 ? 'Переход невозможен' : 'Не удалось изменить статус');
    } finally {
      setBusy(false);
    }
  };

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const segments = gameTime
    ? splitIntoPhaseSegments(startsAt, endsAt, gameTime)
    : [];
  const totalMs = endsAt.getTime() - startsAt.getTime();
  const canConduct = canManage || isRl;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg" >
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">
                {event.eventTypeName} <Badge tone="accent">{MODE_LABELS[event.mode]}</Badge>{' '}
                <Badge>{STATUS_LABELS[event.status]}</Badge>
              </h2>
              <p className="mt-1 text-sm text-secondary">
                {startsAt.toLocaleString('ru-RU', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                —{' '}
                {endsAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{' '}
                (время ваше, хранится в UTC)
              </p>
            </div>
            <Button onClick={onClose}>×</Button>
          </div>

          {segments.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-secondary">Фазы игрового времени на длительность ивента:</p>
              <span className="flex h-6 w-full overflow-hidden rounded-md border border-line">
                {segments.map((segment, index) => (
                  <span
                    key={index}
                    style={{ width: `${((segment.endsAt.getTime() - segment.startsAt.getTime()) / totalMs) * 100}%` }}
                    className={`flex items-center justify-center text-[10px] ${
                      segment.phase === 'DAY' ? 'bg-[#f5c84c] text-black' : 'bg-[#3b4a6b] text-white'
                    }`}
                  >
                    {segment.phase === 'DAY' ? 'день' : 'ночь'}
                  </span>
                ))}
              </span>
            </div>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-secondary">Плата ДКП</dt>
            <dd>{event.dkpReward} (фиксирована при создании)</dd>
            <dt className="text-secondary">Рейд-лид</dt>
            <dd>{event.raidLeadName}</dd>
            {event.place && (
              <>
                <dt className="text-secondary">Место сбора</dt>
                <dd>{event.place}</dd>
              </>
            )}
            {event.notes && (
              <>
                <dt className="text-secondary">Заметки</dt>
                <dd>{event.notes}</dd>
              </>
            )}
          </dl>

          {/* Чек-ин кодами (план 2.2): игрок отмечается, РЛ видит код */}
          {(event.status === 'PLANNED' || event.status === 'RUNNING') && (
            <CheckInPanel eventId={event.id} />
          )}
          {canConduct && (event.status === 'PLANNED' || event.status === 'RUNNING') && (
            <RaidLeadCodePanel eventId={event.id} />
          )}

          {canConduct && event.status === 'PLANNED' && (
            <div className="mt-3 flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => changeStatus('RUNNING')}>
                Начать ивент
              </Button>
              <Button disabled={busy} onClick={() => changeStatus('CANCELLED')}>
                Отменить
              </Button>
            </div>
          )}
          {canConduct && event.status === 'RUNNING' && (
            <div className="mt-3 flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => changeStatus('FINISHED')}>
                Завершить
              </Button>
              <Button disabled={busy} onClick={() => changeStatus('CANCELLED')}>
                Отменить
              </Button>
            </div>
          )}
          {!canConduct && (
            <p className="mt-3 text-xs text-secondary">
              Управление ивентом — офицеры и РЛ (сейчас: {RANK_LABELS.MEMBER} может только смотреть).
            </p>
          )}
          {message && <p className="mt-2 text-sm">{message}</p>}
        </div>
      </Card>
    </div>
  );
}
