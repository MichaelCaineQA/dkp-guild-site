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
export function DashboardScreen() {
  const { user } = useSession();
  const allowed = !!user && can(user, 'members.view_roster');
  const auditAllowed = !!user && can(user, 'audit.view');
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DashboardEvent | null>(null);
  const [now, setNow] = useState(() => new Date());
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
        <DashboardWidget title="События дня">
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
