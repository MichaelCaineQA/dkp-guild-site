'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  applyEventSummarySchema,
  can,
  type ApplyEventSummaryInput,
  type ApplyEventSummaryResult,
  type EventSummaryRow,
  type SummaryAction,
} from '@dkp/shared';
import { useSession } from '../../../../components/session-context';
import { createRequestId } from '../../../../lib/request-id';
import { api } from '../../../../lib/api';
import { AbsentMembersPanel } from '../../../../components/absent-members-panel';
import { RaidLeadCodePanel } from '../../../../components/checkin-panels';
import { SummaryCorrectionDialog } from '../../../../components/summary-correction-dialog';
import {
  Button,
  Card,
  ErrorText,
  EventSummaryTable,
  describeSummaryAction,
  Muted,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
  Stack,
} from '../../../../components/ui';
interface EventRow {
  id: string;
  name?: string;
  eventTypeName: string;
  status: string;
  startsAt: string;
  dkpReward: number;
  raidLeadId: string;
  raidLeadName: string;
}
const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Запланирован',
  RUNNING: 'Идёт',
  FINISHED: 'Завершён',
  CANCELLED: 'Отменён',
};
export default function ConductPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user, loading } = useSession();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [rows, setRows] = useState<EventSummaryRow[]>([]);
  const [error, setError] = useState('');
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [actions, setActions] = useState<SummaryAction[]>([]);
  const [editing, setEditing] = useState<{
    row: EventSummaryRow;
    kind: SummaryAction['kind'];
  } | null>(null);
  const [attempt, setAttempt] = useState<ApplyEventSummaryInput | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    try {
      const [value, checklist] = await Promise.all([
        api<EventRow>(`/events/${eventId}`),
        api<EventSummaryRow[]>(`/events/${eventId}/conduct/checklist`),
      ]);
      setEvent(value);
      setRows(checklist);
      setError('');
      setVersion((v) => v + 1);
    } catch {
      setError('Не удалось загрузить ивент');
    }
  }, [eventId]);
  useEffect(() => {
    if (!loading && (user?.memberId || user?.isAdmin)) void load();
  }, [loading, user, load]);
  if (loading) return <Page>Загрузка…</Page>;
  if (!user || (!user.memberId && !user.isAdmin))
    return (
      <Page>
        <PageHeader
          title="Проведение ивента"
          subtitle="Раздел доступен членам гильдии после входа."
        />
      </Page>
    );
  if (!event) return <Page>{error ? <ErrorText>{error}</ErrorText> : 'Загрузка…'}</Page>;
  const allowed = can(user, 'events.conduct', event);
  const canEdit = allowed && event.status !== 'CANCELLED';
  const locked = busy || attempt !== null;
  const apply = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure('');
    setMessage('');
    try {
      const submission = attempt ?? { requestId: createRequestId(), actions };
      setAttempt(submission);
      const result = await api<ApplyEventSummaryResult>(`/events/${eventId}/conduct/summary`, {
        method: 'POST',
        body: JSON.stringify(submission),
      });
      setActions([]);
      setAttempt(null);
      setMessage(
        `Итоги сохранены. Корректировок: ${result.applied}${result.repeated ? ' (повтор запроса без новых начислений)' : ''}.`,
      );
      window.dispatchEvent(new Event('dkp:changed'));
      await load();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (!attempt && status && [400, 403, 404, 409].includes(status)) {
        setAttempt(null);
        setFailure(
          status === 409
            ? 'Запрос отклонён: данные изменились или ивент отменён. Проверьте черновик по обновлённому списку.'
            : 'Запрос отклонён. Проверьте права, состав и поля корректировок.',
        );
        await load();
      } else
        setFailure(
          'Результат не подтверждён. Черновик зафиксирован: повторите тот же запрос. Повтор не начислит ДКП дважды.',
        );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const stats = (status: string) => rows.filter((r) => r.attendanceStatus === status).length;
  return (
    <Page width="wide">
      <PageHeader
        title={`Проведение: ${event.name || event.eventTypeName}`}
        subtitle={`${new Date(event.startsAt).toLocaleString('ru-RU')} · РЛ: ${event.raidLeadName} · плата ${event.dkpReward} ДКП · ${STATUS_LABELS[event.status]}`}
      />
      <Stack>
        {error && <ErrorText>{error}</ErrorText>}
        {message && <Notice tone="success">{message}</Notice>}
        <AbsentMembersPanel key={version} eventId={event.id} eventStartsAt={event.startsAt} />
        {canEdit && event.status !== 'FINISHED' && (
          <ConductActionsPanel
            key={`codes-${version}`}
            eventId={eventId}
            status={event.status}
            onDone={(msg) => {
              setMessage(msg);
              void load();
            }}
          />
        )}
        <Card>
          <SectionTitle>Чек-лист участников</SectionTitle>
          <p className="mb-2 text-sm text-secondary">
            Присутствие: {stats('PRESENT')} участвовали · {stats('LATE')} опоздали ·{' '}
            {stats('EXCUSED_ABSENCE')} по ув. причине · всего начислено{' '}
            {rows.reduce((sum, row) => sum + row.dkpEarned, 0)} ДКП
          </p>
          <p className="mb-3 text-xs text-secondary">
            Автостатус рассчитан по текущим кодам и отсутствиям; пока окна не закрыты, он может
            измениться. Ранее сохранённая ручная отметка имеет приоритет.
          </p>
          <Button disabled={busy} onClick={() => void load()}>
            Обновить список
          </Button>
          <EventSummaryTable
            rows={rows}
            actions={actions}
            canEdit={canEdit}
            locked={locked}
            onEdit={(row, kind) => setEditing({ row, kind })}
          />
        </Card>
        {(canEdit || attempt) && (
          <Card>
            <SectionTitle>Подготовленные корректировки ({actions.length})</SectionTitle>
            <Muted>
              ДКП за код рассчитываются по настройкам гильдии. Записи журнала не переписываются.
              Черновик сохраняется только при применении итогов.
            </Muted>
            {actions.length === 0 && <p className="mt-2">Корректировок пока нет</p>}
            <ol className="my-3 flex flex-col gap-2">
              {actions.map((action, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {rows.find((row) => row.memberId === action.memberId)?.memberName ?? 'Участник'}
                    : {describeSummaryAction(action)}
                  </span>
                  <Button
                    disabled={locked}
                    aria-label={`Убрать корректировку ${index + 1}`}
                    onClick={() => setActions((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Убрать
                  </Button>
                </li>
              ))}
            </ol>
            {failure && (
              <div role="alert">
                <ErrorText>{failure}</ErrorText>
              </div>
            )}
            {allowed && (
              <Button
                variant="primary"
                disabled={busy || actions.length === 0}
                onClick={() => void apply()}
              >
                {busy ? 'Сохранение…' : attempt ? 'Повторить применение' : 'Подвести итоги'}
              </Button>
            )}
          </Card>
        )}
        {!canEdit && (
          <Muted>
            {event.status === 'CANCELLED'
              ? 'Ивент отменён — только просмотр.'
              : 'Корректировки доступны Главе, Админу и назначенному РЛ.'}
          </Muted>
        )}
        {canEdit && !locked && editing && (
          <SummaryCorrectionDialog
            row={editing.row}
            kind={editing.kind}
            onClose={() => setEditing(null)}
            onAdd={(action) => {
              const next = [...actions, action];
              if (
                !applyEventSummarySchema.safeParse({
                  requestId: '00000000-0000-4000-8000-000000000000',
                  actions: next,
                }).success
              )
                return 'Такая корректировка уже подготовлена либо пакет слишком велик.';
              setActions(next);
              setFailure('');
              return null;
            }}
          />
        )}
      </Stack>
    </Page>
  );
}
function ConductActionsPanel({
  eventId,
  status,
  onDone,
}: {
  eventId: string;
  status: string;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (path: string, body: unknown, message: string) => {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      onDone(message);
    } catch {
      setError('Не удалось выполнить действие. Обновите список и проверьте статус ивента.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <SectionTitle>Управление ивентом</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            void act(`/events/${eventId}/checkin/end-early`, null, 'Финальный код запущен')
          }
        >
          Досрочно запустить финальный код
        </Button>
        {status === 'RUNNING' && (
          <Button
            disabled={busy}
            onClick={() =>
              void act(`/events/${eventId}/status`, { status: 'FINISHED' }, 'Ивент завершён')
            }
          >
            Завершить ивент
          </Button>
        )}
      </div>
      <RaidLeadCodePanel eventId={eventId} />
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
