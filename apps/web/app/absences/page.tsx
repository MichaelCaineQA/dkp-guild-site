'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { can } from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Input,
  Muted,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
} from '../../components/ui';

interface AbsenceRow {
  eventName?: string | null;
  id: string;
  memberId: string;
  memberName: string;
  dateFrom: string;
  dateTo: string;
  reason: string;
  status: string;
  seenBy: string[];
}

/**
 * «Мои отсутствия» (issue #11, план 2.3): подать заявку (период + причина),
 * отменить до начала; офицерам — список всех заявок с отметкой «Увидел».
 * Причину видят все члены гильдии; апрува нет — заявка сразу уважительная.
 */
export default function AbsencesPage() {
  const { user, loading: sessionLoading } = useSession();
  const [mine, setMine] = useState<AbsenceRow[]>([]);
  const [all, setAll] = useState<AbsenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSee = useMemo(
    () =>
      user &&
      can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'absence.see'),
    [user],
  );

  const load = useCallback(async () => {
    try {
      const requests: Promise<AbsenceRow[]>[] = [api<AbsenceRow[]>('/absences/mine')];
      if (canSee) {
        requests.push(api<AbsenceRow[]>('/absences'));
      }
      const [mineData, allData] = await Promise.all(requests);
      setMine(mineData);
      setAll(allData ?? null);
      setError(null);
    } catch {
      setError('Не удалось загрузить отсутствия');
    }
  }, [canSee]);

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
        <PageHeader title="Отсутствия" subtitle="Раздел доступен членам гильдии после входа." />
      </Page>
    );
  }

  if (!user.memberId && !user.isAdmin) {
    return (
      <Page>
        <PageHeader
          title="Отсутствия"
          subtitle="Ваш аккаунт ещё не привязан к члену гильдии — отправьте заявку на привязку ника."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Мои отсутствия"
        subtitle="Заявка без апрува сразу означает уважительную причину. Подать можно не позже чем за 3 минуты до старта ивента."
      />
      {error && <ErrorText>{error}</ErrorText>}
      {message && <Notice tone="success">{message}</Notice>}

      <AbsenceForm
        busy={busy}
        onSubmit={async (body) => {
          setBusy(true);
          setMessage(null);
          try {
            await api('/absences', { method: 'POST', body: JSON.stringify(body) });
            setMessage('Заявка подана');
            await load();
          } catch (err) {
            const status = (err as { status?: number }).status;
            setMessage(null);
            setError(
              status === 409
                ? 'Нельзя: период прошёл или до старта ивента меньше 3 минут'
                : status === 400
                  ? 'Проверьте даты и причину (от 3 символов)'
                  : 'Не удалось подать заявку',
            );
          } finally {
            setBusy(false);
          }
        }}
      />

      <div className="mt-4" />

      <Card>
        <SectionTitle>Мои заявки</SectionTitle>
        <AbsenceTable
          rows={mine}
          mine
          onCancel={async (id) => {
            setBusy(true);
            setError(null);
            try {
              await api(`/absences/${id}`, { method: 'DELETE' });
              setMessage('Заявка отменена');
              await load();
            } catch (err) {
              const status = (err as { status?: number }).status;
              setError(
                status === 409 ? 'Ивент уже начался — отменить нельзя' : 'Не удалось отменить',
              );
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
        />
      </Card>

      {canSee && all !== null && (
        <>
          <div className="mt-4" />
          <Card>
            <SectionTitle>Все заявки гильдии</SectionTitle>
            <AbsenceTable
              rows={all}
              onSeen={async (id) => {
                try {
                  await api(`/absences/${id}/seen`, { method: 'POST' });
                  await load();
                } catch {
                  setError('Не удалось отметить «Увидел»');
                }
              }}
              busy={busy}
              myMemberId={user.memberId}
            />
          </Card>
        </>
      )}
    </Page>
  );
}

/** Форма подачи: день или период (с–по) + причина (план 2.3). */
function AbsenceForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: { dateFrom: string; dateTo: string; reason: string }) => Promise<void>;
}) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reason, setReason] = useState('');

  return (
    <Card>
      <SectionTitle>Подать заявку</SectionTitle>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            dateFrom: new Date(dateFrom).toISOString(),
            dateTo: new Date(dateTo || dateFrom).toISOString(),
            reason,
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-secondary">С</span>
          <Input
            type="date"
            value={dateFrom}
            required
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-secondary">По (необязательно)</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-secondary">Причина (видна всем)</span>
          <Input
            value={reason}
            required
            minLength={3}
            maxLength={500}
            placeholder="Например: работа, отпуск"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button variant="primary" type="submit" disabled={busy || !dateFrom || reason.length < 3}>
          Подать
        </Button>
      </form>
    </Card>
  );
}

/** Таблица заявок: свои — с отменой, офицерские — с «Увидел». */
function AbsenceTable({
  rows,
  mine = false,
  onCancel,
  onSeen,
  busy,
  myMemberId,
}: {
  rows: AbsenceRow[];
  mine?: boolean;
  onCancel?: (id: string) => Promise<void>;
  onSeen?: (id: string) => Promise<void>;
  busy?: boolean;
  myMemberId?: string | null;
}) {
  if (rows.length === 0) {
    return <Muted>{mine ? 'Заявок пока нет' : 'Активных заявок нет'}</Muted>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="border-b border-line px-3 py-2 text-left font-semibold text-secondary">
            Кто
          </th>
          <th className="border-b border-line px-3 py-2 text-left font-semibold text-secondary">
            Период
          </th>
          <th className="border-b border-line px-3 py-2 text-left font-semibold text-secondary">
            Причина
          </th>
          <th className="border-b border-line px-3 py-2 text-left font-semibold text-secondary">
            Увидели
          </th>
          <th className="border-b border-line px-3 py-2 text-left font-semibold text-secondary">
            Действия
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="border-b border-line px-3 py-2">
              {row.memberName}
              {myMemberId && row.memberId === myMemberId && <Muted> (вы)</Muted>}
            </td>
            <td className="border-b border-line px-3 py-2">
              {row.eventName && <span className="block font-medium">{row.eventName}</span>}
              {new Date(row.dateFrom).toLocaleDateString('ru-RU')}
              {row.dateTo !== row.dateFrom &&
                ` — ${new Date(row.dateTo).toLocaleDateString('ru-RU')}`}
            </td>
            <td className="border-b border-line px-3 py-2">{row.reason || 'Без причины'}</td>
            <td className="border-b border-line px-3 py-2">
              {row.seenBy.length > 0 ? (
                <Badge tone="success">{row.seenBy.length} видели</Badge>
              ) : (
                <Muted>—</Muted>
              )}
            </td>
            <td className="border-b border-line px-3 py-2">
              {mine && onCancel && (
                <Button disabled={busy} onClick={() => void onCancel(row.id)}>
                  Отменить
                </Button>
              )}
              {!mine && onSeen && (
                <Button
                  disabled={busy || row.seenBy.includes(myMemberId ?? '')}
                  onClick={() => void onSeen(row.id)}
                >
                  {row.seenBy.includes(myMemberId ?? '') ? '✓ Увидено' : 'Увидел'}
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
