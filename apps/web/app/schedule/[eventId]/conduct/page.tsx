'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ATTENDANCE_STATUSES, can, type AttendanceStatus } from '@dkp/shared';
import { useSession } from '../../../../components/session-context';
import { api } from '../../../../lib/api';
import { AbsentMembersPanel } from '../../../../components/absent-members-panel';
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
  Select,
  Table,
} from '../../../../components/ui';

interface EventRow {
  id: string;
  eventTypeName: string;
  mode: string;
  status: string;
  startsAt: string;
  endsAt: string;
  dkpReward: number;
  raidLeadId: string;
  raidLeadName: string;
}

interface ChecklistRow {
  memberId: string;
  memberName: string;
  attendanceStatus: string | null;
  checkinStart: string;
  checkinEnd: string;
  dkpEarned: number;
}

const CHECKIN_LABELS: Record<string, string> = {
  PENDING: '—',
  ACTIVE: 'вводит',
  PASSED: '✅ сам',
  FAILED: '❌ ошибка',
  EXPIRED: 'не успел',
  MANUAL: '🤝 РЛ',
};

const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'был',
  LATE: 'опоздал',
  LEFT_EARLY: 'ушёл раньше',
  NO_SHOW: 'неявка',
  EXCUSED_ABSENCE: 'уважительная',
};

const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Запланирован',
  RUNNING: 'Идёт',
  FINISHED: 'Завершён',
  CANCELLED: 'Отменён',
};

/**
 * Проведение ивента (issue #10, план 2.2 п.6): чек-лист РЛ с ручными
 * отметками и начислениями, досрочный финальный код, итоговая сводка.
 * Доступ: Глава, Админ и назначенный РЛ ивента; остальным — только чтение чек-листа.
 */
export default function ConductPage() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const { user, loading: sessionLoading } = useSession();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [eventData, checklist] = await Promise.all([
        api<EventRow>(`/events/${eventId}`),
        api<ChecklistRow[]>(`/events/${eventId}/conduct/checklist`),
      ]);
      setEvent(eventData);
      setRows(checklist);
      setError(null);
    } catch {
      setError('Не удалось загрузить ивент');
    }
  }, [eventId]);

  useEffect(() => {
    if (!sessionLoading && user?.memberId) {
      void load();
    }
  }, [sessionLoading, user, load]);

  const canConduct = useMemo(
    () => !!user && !!event && event.status !== 'CANCELLED' && can(user, 'events.conduct', event),
    [user, event],
  );

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return (
      <Page>
        <PageHeader
          title="Проведение ивента"
          subtitle="Раздел доступен членам гильдии после входа."
        />
      </Page>
    );
  }

  if (error && !event) {
    return (
      <Page>
        <PageHeader title="Проведение ивента" />
        <ErrorText>{error}</ErrorText>
      </Page>
    );
  }

  if (!event) {
    return <Page>Загрузка…</Page>;
  }

  const totalEarned = rows.reduce((sum, row) => sum + row.dkpEarned, 0);
  const present = rows.filter((r) => r.attendanceStatus === 'PRESENT').length;
  const late = rows.filter((r) => r.attendanceStatus === 'LATE').length;
  const absent = rows.filter((r) => r.attendanceStatus === 'EXCUSED_ABSENCE').length;

  return (
    <Page width="wide">
      <PageHeader
        title={`Проведение: ${event.eventTypeName}`}
        subtitle={`${new Date(event.startsAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · РЛ: ${event.raidLeadName} · плата ${event.dkpReward} ДКП · ${STATUS_LABELS[event.status]}`}
      />
      {error && <ErrorText>{error}</ErrorText>}
      {message && <Notice tone="success">{message}</Notice>}

      <AbsentMembersPanel eventId={event.id} eventStartsAt={event.startsAt} />

      {canConduct && event.status !== 'FINISHED' && event.status !== 'CANCELLED' && (
        <>
          <div className="mt-4" />
          <ConductActionsPanel
            eventId={eventId}
            rows={rows}
            onDone={(msg) => {
              setMessage(msg);
              void load();
            }}
          />
        </>
      )}

      <div className="mt-4" />
      <Card>
        <SectionTitle>Чек-лист участников</SectionTitle>
        <p className="mb-3 text-sm text-secondary">
          Присутствие: {present} был · {late} опоздал · {absent} уважительная · всего начислено{' '}
          {totalEarned} ДКП
        </p>
        <Table>
          <thead>
            <tr>
              <Table.Th>Участник</Table.Th>
              <Table.Th>Старт</Table.Th>
              <Table.Th>Финал</Table.Th>
              <Table.Th>Отметка РЛ</Table.Th>
              <Table.Th>ДКП</Table.Th>
              {canConduct && event.status !== 'CANCELLED' && <Table.Th>Ручные действия</Table.Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ConductRow
                key={row.memberId}
                row={row}
                eventId={eventId}
                canConduct={canConduct}
                eventClosed={event.status === 'CANCELLED'}
                onDone={(msg) => {
                  setMessage(msg);
                  void load();
                }}
              />
            ))}
          </tbody>
        </Table>
      </Card>
    </Page>
  );
}

/** Верхняя панель РЛ: досрочный финальный код, завершение ивента. */
function ConductActionsPanel({
  eventId,
  rows,
  onDone,
}: {
  eventId: string;
  rows: ChecklistRow[];
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [earlyCode, setEarlyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startEndEarly = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ code: string; windowClosesAt: string }>(
        `/events/${eventId}/checkin/end-early`,
        { method: 'POST' },
      );
      setEarlyCode(result.code);
      onDone(
        `Финальный код запущен: ${result.code} (до ${new Date(result.windowClosesAt).toLocaleTimeString('ru-RU')})`,
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 409
          ? 'Код уже сгенерирован или плановое окно открылось'
          : 'Не удалось запустить код',
      );
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/events/${eventId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'FINISHED' }),
      });
      onDone('Ивент завершён; отсутствующим по уважительной проставлено автоматически');
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 409 ? 'Сначала переведите ивент в статус «Идёт»' : 'Не удалось завершить',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Управление ивентом</SectionTitle>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy} onClick={startEndEarly}>
          Досрочно запустить финальный код
        </Button>
        <Button disabled={busy} onClick={finish}>
          Завершить ивент
        </Button>
        <Muted>
          {rows.filter((r) => r.checkinStart === 'PENDING').length} ещё не отметились на старте
        </Muted>
      </div>
      {earlyCode && (
        <p className="mt-3 text-3xl font-bold tracking-widest tabular-nums">{earlyCode}</p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}

/** Строка чек-листа: статусы чек-ина, отметка РЛ, ручные действия. */
function ConductRow({
  row,
  eventId,
  canConduct,
  eventClosed,
  onDone,
}: {
  row: ChecklistRow;
  eventId: string;
  canConduct: boolean;
  eventClosed: boolean;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [showDkp, setShowDkp] = useState(false);
  const [dkpAmount, setDkpAmount] = useState('1');

  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      setComment('');
      setShowDkp(false);
      onDone(message);
    } catch (err) {
      const status = (err as { status?: number }).status;
      onDone(status === 409 ? 'Конфликт: уже отмечено' : 'Не удалось выполнить действие');
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <Table.Td className="font-medium">{row.memberName}</Table.Td>
      <Table.Td>
        <Badge
          tone={
            row.checkinStart === 'PASSED'
              ? 'success'
              : row.checkinStart === 'MANUAL'
                ? 'accent'
                : 'neutral'
          }
        >
          {CHECKIN_LABELS[row.checkinStart] ?? row.checkinStart}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Badge
          tone={
            row.checkinEnd === 'PASSED'
              ? 'success'
              : row.checkinEnd === 'MANUAL'
                ? 'accent'
                : 'neutral'
          }
        >
          {CHECKIN_LABELS[row.checkinEnd] ?? row.checkinEnd}
        </Badge>
      </Table.Td>
      <Table.Td>
        {row.attendanceStatus ? (
          <Badge tone={row.attendanceStatus === 'NO_SHOW' ? 'danger' : 'neutral'}>
            {ATTENDANCE_LABELS[row.attendanceStatus as AttendanceStatus] ?? row.attendanceStatus}
          </Badge>
        ) : row.checkinStart === 'PASSED' || row.checkinStart === 'MANUAL' ? (
          <Muted>отмечен кодом</Muted>
        ) : (
          <Muted>—</Muted>
        )}
      </Table.Td>
      <Table.Td className="tabular-nums">{row.dkpEarned}</Table.Td>
      {canConduct && !eventClosed && (
        <Table.Td>
          <div className="flex flex-wrap items-center gap-1">
            <Select
              disabled={busy || row.attendanceStatus === 'EXCUSED_ABSENCE'}
              onChange={(e) => {
                const status = e.target.value;
                if (!status) {
                  return;
                }
                void act(
                  () =>
                    api(`/events/${eventId}/conduct/attendance`, {
                      method: 'POST',
                      body: JSON.stringify({
                        memberId: row.memberId,
                        status,
                        comment: comment || 'Отметка из чек-листа',
                      }),
                    }),
                  `Отметка «${ATTENDANCE_LABELS[status as AttendanceStatus]}» для ${row.memberName} сохранена`,
                );
              }}
              defaultValue=""
            >
              <option value="">отметка…</option>
              {ATTENDANCE_STATUSES.filter((s) => s !== 'EXCUSED_ABSENCE').map((status) => (
                <option key={status} value={status}>
                  {ATTENDANCE_LABELS[status]}
                </option>
              ))}
            </Select>
            {row.checkinStart === 'PENDING' || row.checkinStart === 'FAILED' ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      api(`/events/${eventId}/conduct/manual-checkin`, {
                        method: 'POST',
                        body: JSON.stringify({
                          memberId: row.memberId,
                          phase: 'START',
                          comment: comment || 'Не успел отметиться',
                        }),
                      }),
                    `Старт ${row.memberName}: отмечен вручную`,
                  )
                }
              >
                +старт
              </Button>
            ) : null}
            {row.checkinEnd === 'PENDING' || row.checkinEnd === 'FAILED' ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      api(`/events/${eventId}/conduct/manual-checkin`, {
                        method: 'POST',
                        body: JSON.stringify({
                          memberId: row.memberId,
                          phase: 'END',
                          comment: comment || 'Не успел отметиться',
                        }),
                      }),
                    `Финал ${row.memberName}: отмечен вручную`,
                  )
                }
              >
                +финал
              </Button>
            ) : null}
            <Button disabled={busy} onClick={() => setShowDkp((v) => !v)}>
              ДКП
            </Button>
          </div>
          <div className="mt-1 flex items-center gap-1">
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Комментарий (в аудит)"
              className="w-48"
            />
            {showDkp && (
              <>
                <Input
                  type="number"
                  value={dkpAmount}
                  onChange={(e) => setDkpAmount(e.target.value)}
                  className="w-16"
                />
                <Button
                  disabled={busy || Number(dkpAmount) === 0}
                  onClick={() =>
                    void act(
                      () =>
                        api(`/events/${eventId}/conduct/dkp`, {
                          method: 'POST',
                          body: JSON.stringify({
                            memberId: row.memberId,
                            type: Number(dkpAmount) > 0 ? 'MANUAL_EARN' : 'ADJUSTMENT',
                            amount: Number(dkpAmount),
                            comment: comment || 'Ручное начисление',
                          }),
                        }),
                      `ДКП ${Number(dkpAmount) > 0 ? '+' : ''}${dkpAmount} для ${row.memberName} записан`,
                    )
                  }
                >
                  →
                </Button>
              </>
            )}
          </div>
        </Table.Td>
      )}
    </tr>
  );
}
