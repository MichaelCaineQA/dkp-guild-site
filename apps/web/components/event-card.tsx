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
import { AbsentMembersPanel } from './absent-members-panel';
import { EventRoster } from './event-roster';
import { Badge, Button, Card, Modal } from './ui';
const MODE_LABELS: Record<EventMode, string> = { PVE: 'PvE', PVP: 'PvP' };
const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Запланирован',
  RUNNING: 'Идёт',
  FINISHED: 'Завершён',
  CANCELLED: 'Отменён',
};
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
  const [rosterVersion, setRosterVersion] = useState(0);
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
  const segments = gameTime ? splitIntoPhaseSegments(startsAt, endsAt, gameTime) : [];
  const totalMs = endsAt.getTime() - startsAt.getTime();

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">
            {event.name || event.eventTypeName}{' '}
            <Badge tone="accent">{MODE_LABELS[event.mode]}</Badge>{' '}
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
            — {endsAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{' '}
          </p>
        </div>
        <button
          type="button"
          aria-label="Закрыть карточку"
          onClick={onClose}
          className="shrink-0 rounded-lg px-2.5 py-1 text-lg leading-none text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
        >
          ×
        </button>
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

      {/* Чек-ин кодами (план 2.2): игрок отмечается, РЛ видит код */}
      {(event.status === 'PLANNED' || event.status === 'RUNNING') && (
        <CheckInPanel eventId={event.id} />
      )}
      {canConduct && (event.status === 'PLANNED' || event.status === 'RUNNING') && (
        <RaidLeadCodePanel eventId={event.id} />
      )}

      {/* Оформленно отсутствующие (план 2.3): всем, авто-отметка при закрытии */}
      <AbsentMembersPanel
        key={`absences:${event.id}:${rosterVersion}`}
        eventId={event.id}
        eventStartsAt={event.startsAt}
        eventEndsAt={event.endsAt}
      />
      <EventRoster key={`roster:${event.id}:${rosterVersion}`} eventId={event.id} />

      {(canConduct || (canManage && isEventEditable(event.status))) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-line/60 pt-5">
          {canConduct && event.status === 'PLANNED' && (
            <Button variant="primary" disabled={busy} onClick={() => changeStatus('RUNNING')}>
              Начать ивент
            </Button>
          )}
          {canConduct && event.status === 'RUNNING' && (
            <Button variant="primary" disabled={busy} onClick={() => changeStatus('FINISHED')}>
              Завершить
            </Button>
          )}
          {canConduct && (event.status === 'PLANNED' || event.status === 'RUNNING') && (
            <a
              href={`/schedule/${event.id}/conduct`}
              className="rounded-xl border border-line bg-surface-elevated px-5 py-2.5 text-sm font-semibold text-primary transition-all hover:border-line-accent hover:bg-surface-hover"
            >
              Страница проведения
            </a>
          )}
          {canManage && isEventEditable(event.status) && (
            <Button variant="danger" disabled={busy} onClick={() => changeStatus('CANCELLED')}>
              Отменить ивент
            </Button>
          )}
        </div>
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
