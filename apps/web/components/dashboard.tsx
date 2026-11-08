'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  can,
  canManageEvent,
  getMoscowDayBounds,
  type DashboardData,
  type DashboardEvent,
} from '@dkp/shared';
import { api } from '../lib/api';
import { useSession } from './session-context';
import { EventCard } from './event-card';
import {
  AuditPreview,
  Button,
  DashboardEventButton,
  DashboardGrid,
  DashboardWidget,
  ErrorText,
  Muted,
  Page,
  PageHeader,
  TeamMemberLink,
} from './ui';

interface DashboardAbsence {
  id: string;
  dateFrom: string;
  dateTo: string;
  allDay?: boolean;
  eventName?: string | null;
  reason: string;
  status: string;
  seenBy: string[];
}

function formatAbsencePeriod(from: string, to: string, allDay = false) {
  const start = new Date(from);
  const end = new Date(to);
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  if (allDay)
    return `${date.format(start)} — ${date.format(new Date(end.getTime() - 1))} (весь день)`;
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (start.toDateString() === end.toDateString()) {
    return `${date.format(start)}, ${time.format(start)}–${time.format(end)}`;
  }
  return `${date.format(start)} ${time.format(start)} — ${date.format(end)} ${time.format(end)}`;
}

export function DashboardScreen() {
  const { user } = useSession();
  const allowed = !!user && can(user, 'members.view_roster');
  const auditAllowed = !!user && can(user, 'members.view_roster');
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DashboardEvent | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [absences, setAbsences] = useState<DashboardAbsence[]>([]);
  const [absenceError, setAbsenceError] = useState(false);
  const [absenceLoading, setAbsenceLoading] = useState(true);
  const loadAbsences = useCallback(async () => {
    if (!user?.memberId) {
      setAbsences([]);
      setAbsenceLoading(false);
      return;
    }
    setAbsenceLoading(true);
    try {
      setAbsences(await api<DashboardAbsence[]>('/absences/mine'));
      setAbsenceError(false);
    } catch {
      setAbsenceError(true);
    } finally {
      setAbsenceLoading(false);
    }
  }, [user?.memberId]);
  const load = useCallback(async () => {
    try {
      setData(await api<DashboardData>('/dashboard'));
      setError('');
    } catch {
      setError('Не удалось загрузить дашборд. Попробуйте ещё раз.');
    }
  }, []);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  useEffect(() => {
    if (!allowed) return;
    void loadAbsences();
    const timer = setInterval(() => void loadAbsences(), 15_000);
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadAbsences();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [allowed, loadAbsences]);
  useEffect(() => {
    if (!allowed) return;
    const timer = setInterval(() => {
      const current = new Date();
      setNow(current);
      if (
        data &&
        +getMoscowDayBounds(current).start !== +getMoscowDayBounds(new Date(data.generatedAt)).start
      )
        void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [allowed, data, load]);
  if (!allowed) return null;
  const waiting = !data && !error;
  const gameTime = data?.gameTime
    ? {
        anchor: new Date(data.gameTime.gameTimeAnchor),
        dayMinutes: data.gameTime.gameTimeDayMinutes,
        nightMinutes: data.gameTime.gameTimeNightMinutes,
      }
    : null;
  const fallback = waiting ? (
    <Muted>Загрузка…</Muted>
  ) : error ? (
    <Muted>Данные недоступны</Muted>
  ) : null;
  return (
    <Page width="wide">
      <PageHeader title="Дашборд" />
      {error && (
        <div role="alert">
          <ErrorText>{error}</ErrorText>
          <Button
            onClick={() => {
              void load();
            }}
          >
            Повторить загрузку
          </Button>
        </div>
      )}
      <DashboardGrid>
        <DashboardWidget className="md:col-span-2" title="События дня">
          {fallback ??
            (data?.events.length ? (
              <ul className="space-y-3">
                {data.events.map((event) => (
                  <li key={event.id}>
                    <DashboardEventButton
                      event={event}
                      past={event.status === 'FINISHED' || +new Date(event.endsAt) <= +now}
                      onClick={() => setSelected(event)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>Сегодня отдыхаем!</Muted>
            ))}
        </DashboardWidget>
        <DashboardWidget className="md:col-span-2" title="Мои отсутствия">
          {absenceError ? (
            <div role="alert">
              <ErrorText>Не удалось загрузить отсутствия.</ErrorText>
              <Button onClick={() => void loadAbsences()}>Повторить</Button>
            </div>
          ) : absenceLoading ? (
            <Muted>Загрузка…</Muted>
          ) : !user?.memberId ? (
            <Muted>Список доступен участникам гильдии.</Muted>
          ) : (
            (() => {
              const currentTime = now.getTime();
              const upcoming = absences
                .filter(
                  (absence) =>
                    absence.status === 'ACTIVE' && +new Date(absence.dateTo) >= currentTime,
                )
                .sort((a, b) => {
                  const aCurrent = +new Date(a.dateFrom) <= currentTime;
                  const bCurrent = +new Date(b.dateFrom) <= currentTime;
                  return (
                    Number(bCurrent) - Number(aCurrent) ||
                    +new Date(a.dateFrom) - +new Date(b.dateFrom)
                  );
                })
                .slice(0, 3);
              return upcoming.length ? (
                <ul className="space-y-3">
                  {upcoming.map((absence) => (
                    <li key={absence.id} className="rounded-lg border border-line p-3">
                      <p className="font-medium">
                        {formatAbsencePeriod(absence.dateFrom, absence.dateTo, absence.allDay)}
                      </p>
                      {absence.eventName && <p>{absence.eventName}</p>}
                      {absence.reason && <Muted>{absence.reason}</Muted>}
                      {absence.seenBy.length > 0 && <Muted>Увидел</Muted>}
                    </li>
                  ))}
                </ul>
              ) : (
                <Muted>Нет запланированных отсутствий</Muted>
              );
            })()
          )}
          <div className="flex flex-wrap gap-4">
            <a className="text-accent underline" href="/absences">
              Все мои отсутствия
            </a>
            <a className="text-accent underline" href="/absences">
              Оформить отсутствие
            </a>
          </div>
        </DashboardWidget>
        <DashboardWidget title={data?.team ? `Моя команда: ${data.team.name}` : 'Моя команда'}>
          {fallback ??
            (data?.team ? (
              <ul>
                {data.team.members.map((member) => (
                  <li key={member.id}>
                    <TeamMemberLink member={member} />
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>Здесь появится информация о твоём паке после того, как тебя распределят</Muted>
            ))}
        </DashboardWidget>
        <DashboardWidget title="Мой аукцион">
          <Muted>Скоро тут будут ваши лоты</Muted>
        </DashboardWidget>
        <DashboardWidget title="Лог действий">
          {!auditAllowed ? (
            <Muted>Журнал действий доступен Офицеру, Главе и Админу</Muted>
          ) : (
            (fallback ?? (
              <>
                {data?.audit?.length === 0 && <Muted>Записей пока нет</Muted>}
                <AuditPreview entries={data?.audit ?? []} />
              </>
            ))
          )}
        </DashboardWidget>
      </DashboardGrid>
      {selected && user && (
        <EventCard
          event={selected}
          gameTime={gameTime}
          canManage={canManageEvent(user, selected)}
          canConduct={can(user, 'events.conduct', selected)}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </Page>
  );
}
