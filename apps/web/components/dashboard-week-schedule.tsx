'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLocalWeekBounds,
  groupEventsByLocalDay,
  localDayKey,
  weekDays,
  type WeekEvent,
} from '@dkp/shared';
import { api } from '../lib/api';
import {
  Button,
  DashboardWidget,
  ErrorText,
  Muted,
  WeekScheduleDay,
  WeekScheduleEventButton,
  WeekScheduleGrid,
} from './ui';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const dayHeaderFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const rangeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Виджет дашборда «Расписание на неделю» (issue #203): семь дней пн–вс
 * в таймзоне браузера устройства (решение 20), навигация по неделям,
 * клик открывает общую карточку события.
 */
export function DashboardWeekSchedule({
  now,
  onSelect,
  reloadSignal,
}: {
  now: Date;
  onSelect: (event: WeekEvent) => void;
  reloadSignal: number;
}) {
  const [weekCursor, setWeekCursor] = useState(() => getLocalWeekBounds(now).start);
  // События хранятся вместе с неделей, которой принадлежат: поздний ответ
  // прошлого запроса и карточки чужой недели не попадают в выбранный период.
  const [loaded, setLoaded] = useState<{ weekStart: number; events: WeekEvent[] } | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (weekStart: Date) => {
    const request = ++generation.current;
    setError(false);
    const { start, end } = getLocalWeekBounds(weekStart);
    const params = new URLSearchParams({ from: start.toISOString(), to: end.toISOString() });
    try {
      const events = await api<WeekEvent[]>(`/schedule/week?${params}`);
      if (request !== generation.current) return;
      setLoaded({ weekStart: +start, events });
    } catch {
      if (request !== generation.current) return;
      setLoaded(null);
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load(weekCursor);
    return () => {
      generation.current++;
    };
  }, [weekCursor, load, reloadSignal]);

  const week = getLocalWeekBounds(weekCursor);
  const days = weekDays(week.start);
  const isCurrentWeek = +week.start === +getLocalWeekBounds(now).start;
  const events = loaded && loaded.weekStart === +week.start ? loaded.events : null;
  const byDay = events ? groupEventsByLocalDay(events) : null;

  return (
    <DashboardWidget className="md:col-span-2" title="Расписание на неделю">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">
          {rangeFmt.format(days[0])} — {rangeFmt.format(days[6])}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-label="Предыдущая неделя"
            onClick={() => {
              setWeekCursor((prev) => {
                const next = new Date(prev);
                next.setDate(next.getDate() - 7);
                return next;
              });
            }}
          >
            ←
          </Button>
          <Button
            disabled={isCurrentWeek}
            onClick={() => setWeekCursor(getLocalWeekBounds(now).start)}
          >
            Текущая неделя
          </Button>
          <Button
            aria-label="Следующая неделя"
            onClick={() => {
              setWeekCursor((prev) => {
                const next = new Date(prev);
                next.setDate(next.getDate() + 7);
                return next;
              });
            }}
          >
            →
          </Button>
        </div>
      </div>
      {error && !events ? (
        <div role="alert">
          <ErrorText>Не удалось загрузить расписание.</ErrorText>
          <Button onClick={() => void load(weekCursor)}>Повторить загрузку</Button>
        </div>
      ) : !events || !byDay ? (
        <Muted>Загрузка…</Muted>
      ) : (
        <>
          {events.length === 0 && <Muted>На этой неделе событий нет</Muted>}
          <WeekScheduleGrid>
            {days.map((day, index) => {
              const dayEvents = byDay.get(localDayKey(day)) ?? [];
              return (
                <WeekScheduleDay
                  key={localDayKey(day)}
                  header={`${WEEKDAYS[index]}, ${dayHeaderFmt.format(day)}`}
                  today={localDayKey(day) === localDayKey(now)}
                >
                  {dayEvents.length === 0 ? (
                    <Muted>Нет событий</Muted>
                  ) : (
                    dayEvents.map((event) => (
                      <WeekScheduleEventButton
                        key={event.id}
                        event={event}
                        past={event.status === 'FINISHED' || +new Date(event.endsAt) <= +now}
                        onClick={() => onSelect(event)}
                      />
                    ))
                  )}
                </WeekScheduleDay>
              );
            })}
          </WeekScheduleGrid>
        </>
      )}
    </DashboardWidget>
  );
}
