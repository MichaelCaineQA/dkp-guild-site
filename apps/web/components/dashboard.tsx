'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  can,
  canManageEvent,
  getMoscowDayBounds,
  type DashboardData,
  type DashboardEvent,
  type MemberWallet,
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
  const [wallet, setWallet] = useState<MemberWallet | null>(null);
  const [walletError, setWalletError] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);
  const loadWallet = useCallback(async () => {
    if (!user?.memberId) {
      setWallet(null);
      setWalletLoading(false);
      return;
    }
    setWalletLoading(true);
    try {
      setWallet(await api<MemberWallet>('/dashboard/wallet'));
      setWalletError(false);
    } catch {
      setWalletError(true);
    } finally {
      setWalletLoading(false);
    }
  }, [user?.memberId]);
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
    // Кошелёк (issue #81): ставки, статусы лотов и баланс журнала меняются —
    // карточка обновляется опросом, без перезагрузки страницы.
    void loadWallet();
    const timer = setInterval(() => {
      void loadAbsences();
      void loadWallet();
    }, 15_000);
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void loadAbsences();
        void loadWallet();
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [allowed, loadAbsences, loadWallet]);
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
        <DashboardWidget title="Мой кошелёк">
          {walletError ? (
            <div role="alert">
              <ErrorText>Не удалось загрузить кошелёк.</ErrorText>
              <Button onClick={() => void loadWallet()}>Повторить</Button>
            </div>
          ) : walletLoading && !wallet ? (
            <Muted>Загрузка…</Muted>
          ) : !wallet ? (
            <Muted>Кошелёк доступен участникам гильдии.</Muted>
          ) : (
            <div className="flex h-full flex-col gap-2">
              <p className="text-2xl font-semibold tabular-nums">Баланс: {wallet.balance} ДКП</p>
              <p className="tabular-nums">Заморожено: {wallet.frozen} ДКП</p>
              <Muted>Спишется, если вы выиграете текущие лоты</Muted>
              <p className="tabular-nums">Доступно для новых ставок: {wallet.available} ДКП</p>
              {wallet.lots.length > 0 && (
                <ul className="space-y-1">
                  {wallet.lots.map((lot) => (
                    <li key={lot.lotId}>
                      <a className="underline hover:text-accent" href="/auction">
                        {lot.itemName}
                      </a>{' '}
                      — <span className="tabular-nums">{lot.fullCost} ДКП</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto flex flex-wrap gap-4">
                <a className="text-accent underline" href="/dkp">
                  История ДКП
                </a>
                <a className="text-accent underline" href="/auction">
                  Мои лоты
                </a>
              </div>
            </div>
          )}
        </DashboardWidget>
        <DashboardWidget title="Мои отсутствия">
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
          {data?.auction ? (
            <div className="flex h-full flex-col gap-2">
              <div className="font-medium">{data.auction.itemName}</div>
              <div className="flex flex-col gap-1">
                <span>
                  {data.auction.endsAt
                    ? `Окончание: ${new Date(data.auction.endsAt).toLocaleString('ru-RU', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}`
                    : 'Таймер стартует с первой ставки'}
                </span>
                {data.auction.topBid ? (
                  <span>
                    Текущая ставка:{' '}
                    <span className="tabular-nums">{data.auction.topBid.amount} ДКП</span> —{' '}
                    {data.auction.topBid.memberName}
                  </span>
                ) : (
                  <Muted>Ставок пока нет</Muted>
                )}
              </div>
              <div className="mt-auto">
                <Button onClick={() => (window.location.href = '/auction')}>Открыть аукцион</Button>
              </div>
            </div>
          ) : (
            <Muted>Скоро тут будут ваши лоты</Muted>
          )}
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
