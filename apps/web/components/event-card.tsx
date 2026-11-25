'use client';
import { useSession } from './session-context';
import { EventParticipation } from './event-participation';
import { useState } from 'react';
import {
  isEventEditable,
  splitIntoPhaseSegments,
  type EventMode,
  type GamePhaseConfig,
} from '@dkp/shared';
import type { DashboardEvent as EventRow } from '@dkp/shared';
import { api } from '../lib/api';
import { CheckInPanel, RaidLeadCodePanel } from './checkin-panels';
import { FINISH_EVENT_COPY, START_EVENT_COPY } from './event-actions';
import { AbsentMembersPanel } from './absent-members-panel';
import { EventRoster } from './event-roster';
import { EditEventScopeDialog } from './edit-event-scope-dialog';
import { Badge, Button, Card, ConfirmDialog, Modal } from './ui';
const MODE_LABELS: Record<EventMode, string> = { PVE: 'PvE', PVP: 'PvP' };
const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Запланирован',
  RUNNING: 'Идёт',
  FINISHED: 'Завершён',
  CANCELLED: 'Отменён',
};
/** Действие, которое меняет статус ивента; начало и завершение открывают окно кода. */
type StatusAction = 'RUNNING' | 'FINISHED' | 'CANCELLED';
/** Карточка ивента: шкала фаз на его длительность, детали, статусы. */
export function EventCard({
  event,
  gameTime,
  canManage,
  canConduct,
  onClose,
  onChanged,
  presentation = 'dialog',
}: {
  presentation?: 'dialog' | 'panel';
  event: EventRow;
  gameTime: GamePhaseConfig | null;
  canManage: boolean;
  canConduct: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [editingScope, setEditingScope] = useState(false);
  const [rosterVersion, setRosterVersion] = useState(0);
  /** Счётчик перезапуска блока кода: после «Начать»/«Завершить» код читается сразу. */
  const [codesVersion, setCodesVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * Статус, который эта карточка только что установила. Родитель перечитывает
   * ивент сам, но не везде обновляет открытую карточку (окно статистики держит
   * строку отчёта) — пока он не принёс новый статус, показываем свой.
   */
  const [statusOverride, setStatusOverride] = useState<{ from: string; to: string } | null>(null);
  /** Действие, ждущее подтверждения: окно кода открывается один раз, завершённый ивент не вернуть. */
  const [pending, setPending] = useState<'RUNNING' | 'FINISHED' | null>(null);
  const status =
    statusOverride && statusOverride.from === event.status ? statusOverride.to : event.status;
  const copy = pending === 'RUNNING' ? START_EVENT_COPY : FINISH_EVENT_COPY;

  const changeStatus = async (action: StatusAction) => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/events/${event.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: action }),
      });
      setStatusOverride({ from: event.status, to: action });
      setPending(null);
      setMessage(
        action === 'RUNNING'
          ? 'Ивент начат — окно стартового кода открыто'
          : action === 'FINISHED'
            ? 'Ивент завершён — окно финального кода открыто'
            : 'Статус изменён',
      );
      // Код появляется в карточке сразу, не дожидаясь опроса.
      setCodesVersion((v) => v + 1);
      onChanged();
      if (action === 'CANCELLED') onClose();
    } catch (err) {
      const httpStatus = (err as { status?: number }).status;
      setPending(null);
      setMessage(
        httpStatus === 409
          ? 'Действие уже выполнено — статус ивента изменился'
          : 'Не удалось изменить статус',
      );
      // Ответ мог потеряться после выполнения: перечитываем статус сервера.
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const segments = gameTime ? splitIntoPhaseSegments(startsAt, endsAt, gameTime) : [];
  const totalMs = endsAt.getTime() - startsAt.getTime();

  const content = (
    <>
      <div className="flex items-start justify-between gap-2 pr-8">
        <div>
          <h2 className="text-xl font-semibold">
            {event.name || event.eventTypeName}{' '}
            <Badge tone="accent">{MODE_LABELS[event.mode]}</Badge>{' '}
            <Badge>{STATUS_LABELS[status]}</Badge>
          </h2>
          <p className="mt-1 text-sm text-secondary">
            {startsAt.toLocaleString('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            — {endsAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{' '}
          </p>
        </div>
      </div>

      {segments.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-secondary">
            Фазы игрового времени на длительность ивента:
          </p>
          <span className="flex h-6 w-full overflow-hidden rounded-md border border-line">
            {segments.map((segment, index) => (
              <span
                key={index}
                style={{
                  width: `${((segment.endsAt.getTime() - segment.startsAt.getTime()) / totalMs) * 100}%`,
                }}
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
        <dt>Состав</dt>
        <dd>{event.scopeName}</dd>
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

      {user?.memberId && (
        <EventParticipation
          key={event.id}
          eventId={event.id}
          onChanged={() => {
            setRosterVersion((v) => v + 1);
            onChanged();
          }}
        />
      )}

      {/* Чек-ин кодами (план 2.2): игрок отмечается, управляющий видит код.
          Финальное окно открыто и после завершения ивента — его и закрывает «Завершить». */}
      {status !== 'CANCELLED' && <CheckInPanel eventId={event.id} />}
      {canConduct && status !== 'CANCELLED' && (
        <RaidLeadCodePanel key={codesVersion} eventId={event.id} />
      )}

      {/* Оформленно отсутствующие (план 2.3): всем, авто-отметка при закрытии */}
      <AbsentMembersPanel
        key={`absences:${event.id}:${rosterVersion}`}
        eventId={event.id}
        eventStartsAt={event.startsAt}
        eventEndsAt={event.endsAt}
      />
      <EventRoster key={`roster:${event.id}:${rosterVersion}`} eventId={event.id} />

      {canConduct && (status === 'PLANNED' || status === 'RUNNING') && (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === 'PLANNED' ? (
            <Button variant="primary" disabled={busy} onClick={() => setPending('RUNNING')}>
              Начать ивент
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => setPending('FINISHED')}>
              Завершить ивент
            </Button>
          )}
          <a
            href={`/schedule/${event.id}/conduct`}
            className="rounded-lg border border-line bg-surface px-4 py-1.5 text-sm font-medium hover:bg-surface-muted"
          >
            Страница проведения
          </a>
        </div>
      )}
      {pending && (
        <ConfirmDialog
          title={copy.title}
          confirmLabel={copy.confirmLabel}
          busy={busy}
          onConfirm={() => void changeStatus(pending)}
          onCancel={() => setPending(null)}
        >
          <p>{copy.text}</p>
        </ConfirmDialog>
      )}
      {canManage && status === 'PLANNED' && (
        <Button onClick={() => setEditingScope(true)}>Изменить состав</Button>
      )}
      {editingScope && (
        <EditEventScopeDialog
          event={event}
          onClose={() => setEditingScope(false)}
          onChanged={() => {
            onChanged();
            onClose();
          }}
        />
      )}
      {canManage && isEventEditable(status) && (
        <Button disabled={busy} onClick={() => void changeStatus('CANCELLED')}>
          Отменить
        </Button>
      )}
      {!canConduct && !canManage && (
        <p className="mt-3 text-xs text-secondary">
          Проведение ивента доступно Главе, Админу и назначенному РЛ.
        </p>
      )}
      {message && <p className="mt-2 text-sm">{message}</p>}
    </>
  );
  return presentation === 'panel' ? (
    <Card>{content}</Card>
  ) : (
    <Modal title={event.name || event.eventTypeName} onClose={onClose} wide heading={false}>
      {content}
    </Modal>
  );
}
