'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { can, absenceSeenActorKey } from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Select,
  Muted,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
  Table,
} from '../../components/ui';

interface AbsenceRow {
  eventName?: string | null;
  id: string;
  memberId: string;
  memberName: string;
  dateFrom: string;
  dateTo: string;
  allDay?: boolean;
  reason: string;
  status: string;
  seenBy: string[];
}

/**
 * «Мои отсутствия» (issue #11, план 2.3): подать заявку (период + причина),
 * отменить до начала; офицерам — список всех заявок с отметкой «Увидел».
 * Видимость причины ограничена; апрува нет — заявка сразу уважительная.
 */
export default function AbsencesPage() {
  const { user, loading: sessionLoading } = useSession();
  const [mine, setMine] = useState<AbsenceRow[]>([]);
  const [all, setAll] = useState<AbsenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ id: string; nickname: string }>>([]);

  const canSee = useMemo(
    () =>
      user &&
      can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'absence.see'),
    [user],
  );

  const load = useCallback(async () => {
    try {
      const requests: Promise<AbsenceRow[]>[] = [
        user?.memberId ? api<AbsenceRow[]>('/absences/mine') : Promise.resolve([]),
      ];
      if (user?.memberId || canSee) {
        requests.push(api<AbsenceRow[]>('/absences'));
      }
      const [mineData, allData] = await Promise.all(requests);
      const candidatesData = user?.memberId
        ? await api<Array<{ id: string; nickname: string }>>('/absences/candidates')
        : [];
      setCandidates(candidatesData);
      setMine(mineData);
      setAll(allData ?? null);
      setError(null);
    } catch {
      setError('Не удалось загрузить отсутствия');
    }
  }, [canSee, user?.memberId]);

  useEffect(() => {
    if (!sessionLoading && (user?.memberId || user?.isAdmin)) {
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

      {user.memberId && (
        <AbsenceForm
          busy={busy}
          candidates={candidates}
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
                  ? 'Нельзя подать заявку на полностью прошедший период'
                  : status === 400
                    ? 'Проверьте даты и причину (от 3 символов)'
                    : 'Не удалось подать заявку',
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

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

      {all !== null && (canSee || all.length > 0) && (
        <>
          <div className="mt-4" />
          <Card>
            <SectionTitle>{canSee ? 'Все заявки гильдии' : 'Заявки моей группы'}</SectionTitle>
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
              myMemberId={absenceSeenActorKey(user)}
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
  candidates,
  onSubmit,
}: {
  busy: boolean;
  candidates: Array<{ id: string; nickname: string }>;
  onSubmit: (body: {
    memberId?: string;
    dateFrom: string;
    dateTo: string;
    reason: string;
    allDay: boolean;
  }) => Promise<void>;
}) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [mode, setMode] = useState<'day' | 'interval'>('day');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [reason, setReason] = useState('');
  const [periodError, setPeriodError] = useState('');
  const [memberId, setMemberId] = useState('');

  return (
    <Card>
      <SectionTitle>Подать заявку</SectionTitle>
      <Muted>
        События, до начала которых осталось меньше установленного срока, не попадут в заявку.
      </Muted>
      <Field label="Режим">
        <Select value={mode} onChange={(e) => setMode(e.target.value as 'day' | 'interval')}>
          <option value="day">Весь день</option>
          <option value="interval">Промежуток времени</option>
        </Select>
      </Field>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const start = new Date(`${dateFrom}T${mode === 'day' ? '00:00' : timeFrom}`);
          const end = new Date(`${dateTo || dateFrom}T${mode === 'day' ? '00:00' : timeTo}`);
          if (mode === 'day') end.setDate(end.getDate() + 1);
          if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) {
            setPeriodError('Окончание должно быть позже начала');
            return;
          }
          setPeriodError('');
          void onSubmit({
            ...(memberId ? { memberId } : {}),
            dateFrom: start.toISOString(),
            dateTo: end.toISOString(),
            allDay: mode === 'day',
            reason,
          });
        }}
      >
        {candidates.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-secondary">Игрок</span>
            <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Я</option>
              {candidates.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.nickname}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-secondary">С</span>
          <Input
            type="date"
            value={dateFrom}
            required
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        {mode === 'interval' && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-secondary">Время начала</span>
            <Input
              type="time"
              required
              value={timeFrom}
              onChange={(e) => setTimeFrom(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-secondary">По (необязательно)</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {mode === 'interval' && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-secondary">Время окончания</span>
            <Input
              type="time"
              required
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-secondary">Причина (видна вам и руководству)</span>
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
      {periodError && <ErrorText>{periodError}</ErrorText>}
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
    <Table>
      <thead>
        <tr>
          <Table.Th>Кто</Table.Th>
          <Table.Th>Период</Table.Th>
          <Table.Th>Причина</Table.Th>
          <Table.Th>Увидели</Table.Th>
          <Table.Th>Действия</Table.Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Table.Td>
              {row.memberName}
              {myMemberId && row.memberId === myMemberId && <Muted> (вы)</Muted>}
            </Table.Td>
            <Table.Td>
              {row.eventName && <span className="block font-medium">{row.eventName}</span>}
              {row.allDay
                ? `${new Date(row.dateFrom).toLocaleDateString('ru-RU')} — ${new Date(new Date(row.dateTo).getTime() - 1).toLocaleDateString('ru-RU')} (весь день)`
                : `${new Date(row.dateFrom).toLocaleString('ru-RU')} — ${new Date(row.dateTo).toLocaleString('ru-RU')}`}
            </Table.Td>
            <Table.Td className="break-words">{row.reason || 'Без причины'}</Table.Td>
            <Table.Td>
              {row.seenBy.length > 0 ? (
                <Badge tone="success">{row.seenBy.length} видели</Badge>
              ) : (
                <Muted>—</Muted>
              )}
            </Table.Td>
            <Table.Td>
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
            </Table.Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
