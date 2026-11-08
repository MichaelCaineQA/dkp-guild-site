'use client';
import { useCallback, useEffect, useState } from 'react';
import { absenceSeenActorKey, can } from '@dkp/shared';
import { api } from '../lib/api';
import { useSession } from './session-context';
import { Button, ErrorText, EventAbsences, type EventAbsenceRow } from './ui';
/** Одна и та же отметка заявки в карточке, проведении и списке отсутствий. */
export function AbsentMembersPanel({
  eventStartsAt,
  eventEndsAt,
  eventId,
}: {
  eventStartsAt: string;
  eventEndsAt?: string;
  eventId: string;
}) {
  const { user } = useSession();
  const [absent, setAbsent] = useState<EventAbsenceRow[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const rows = await api<EventAbsenceRow[]>(
      `/absences/for-event?startsAt=${encodeURIComponent(eventStartsAt)}&eventId=${encodeURIComponent(eventId)}${eventEndsAt ? `&endsAt=${encodeURIComponent(eventEndsAt)}` : ''}`,
    );
    setAbsent(rows);
    setError('');
  }, [eventStartsAt, eventEndsAt, eventId]);
  useEffect(() => {
    let active = true;
    api<EventAbsenceRow[]>(
      `/absences/for-event?startsAt=${encodeURIComponent(eventStartsAt)}&eventId=${encodeURIComponent(eventId)}${eventEndsAt ? `&endsAt=${encodeURIComponent(eventEndsAt)}` : ''}`,
    )
      .then((rows) => {
        if (active) {
          setAbsent(rows);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить отсутствия');
      });
    return () => {
      active = false;
    };
  }, [eventStartsAt, eventEndsAt, eventId]);
  if (absent?.length === 0 && !error) return null;
  if (!absent)
    return error ? (
      <div role="alert">
        <ErrorText>{error}</ErrorText>
        <Button
          onClick={() => void load().catch(() => setError('Не удалось загрузить отсутствия'))}
        >
          Повторить
        </Button>
      </div>
    ) : null;
  return (
    <EventAbsences
      rows={absent}
      actorKey={user ? absenceSeenActorKey(user) : null}
      canSee={!!user && can(user, 'absence.see')}
      busyId={busyId}
      error={error}
      onSeen={async (id) => {
        setBusyId(id);
        setError('');
        try {
          await api(`/absences/${id}/seen`, { method: 'POST' });
          await load();
        } catch {
          setError('Не удалось отметить «Увидел». Попробуйте ещё раз.');
        } finally {
          setBusyId(null);
        }
      }}
    />
  );
}
