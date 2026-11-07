'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ParticipationState } from '@dkp/shared';
import { api } from '../lib/api';
import { Button, ErrorText, Field, Input, Modal, Muted, Notice, SectionTitle, Stack } from './ui';
function useParticipation(eventId: string) {
  const [state, setState] = useState<ParticipationState | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setState(await api<ParticipationState>(`/events/${eventId}/participation`));
      setError('');
    } catch {
      setError('Не удалось загрузить участие');
    }
  }, [eventId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { state, error, load };
}
function updateError(error: unknown): string {
  const status = (error as { status?: number }).status;
  return status === 409
    ? 'Участие изменилось или срок истёк. Обновите страницу.'
    : status === 403
      ? 'Изменять можно только собственное участие в приглашённом составе.'
      : 'Не удалось изменить участие. Попробуйте ещё раз.';
}
export function DeclineEventDialog({
  eventId,
  onClose,
  onChanged,
}: {
  eventId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { state, error } = useParticipation(eventId);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Не приду на событие"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!state?.canDecline || busy) return;
          setBusy(true);
          setFailure('');
          try {
            await api(`/events/${eventId}/participation`, {
              method: 'POST',
              body: JSON.stringify({ attending: false, reason }),
            });
            onChanged();
            onClose();
          } catch (err) {
            setFailure(updateError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Stack>
          {!state && !error && <Muted>Загрузка участия…</Muted>}
          {error && <ErrorText>{error}</ErrorText>}
          {state && !state.canDecline && (
            <Notice>Отсутствие уже оформлено либо срок подачи истёк.</Notice>
          )}
          {state?.canDecline && (
            <>
              <Muted>
                Причину увидят участники гильдии. Оформляется отсутствие только на это событие.
              </Muted>
              <Field label="Причина (необязательно)">
                <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Muted>Подать до {new Date(state.deadlineAt).toLocaleString('ru-RU')}.</Muted>
            </>
          )}
          {failure && <ErrorText>{failure}</ErrorText>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={onClose}>
              Закрыть
            </Button>
            {state?.canDecline && (
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Отправка…' : 'Отправить'}
              </Button>
            )}
          </div>
        </Stack>
      </form>
    </Modal>
  );
}
export function EventParticipation({
  eventId,
  onChanged,
}: {
  eventId: string;
  onChanged: () => void;
}) {
  const { state, error, load } = useParticipation(eventId);
  const [dialog, setDialog] = useState<'decline' | 'attend' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const changed = () => {
    void load();
    onChanged();
  };
  return (
    <div className="mt-4 border-t border-line pt-3">
      <SectionTitle>Моё участие</SectionTitle>
      {error && <ErrorText>{error}</ErrorText>}
      {!state && !error && <Muted>Загрузка участия…</Muted>}
      {state &&
        (!state.invited ? (
          <Muted>Вы не входите в приглашённый состав.</Muted>
        ) : (
          <Stack>
            <p>{state.attending ? 'Буду' : 'Не буду'}</p>
            {state.attending && state.canDecline && (
              <Button onClick={() => setDialog('decline')}>Не буду</Button>
            )}
            {!state.attending && state.canAttend && (
              <Button onClick={() => setDialog('attend')}>Буду</Button>
            )}
            {!state.attending && !state.canAttend && <Muted>Срок отмены отсутствия истёк.</Muted>}
          </Stack>
        ))}
      {dialog === 'decline' && (
        <DeclineEventDialog eventId={eventId} onClose={() => setDialog(null)} onChanged={changed} />
      )}
      {dialog === 'attend' && state && (
        <Modal
          title="Отменить отсутствие?"
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <Stack>
            <Notice>
              Будут целиком отменены перечисленные заявки, включая другие события внутри этих
              периодов.
            </Notice>
            <ul>
              {state.absences.map((a) => (
                <li key={a.id}>
                  {new Date(a.dateFrom).toLocaleString('ru-RU')} —{' '}
                  {new Date(a.dateTo).toLocaleString('ru-RU')}
                  {a.reason ? `: ${a.reason}` : ''}
                </li>
              ))}
            </ul>
            {failure && <ErrorText>{failure}</ErrorText>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => setDialog(null)}>
                Назад
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setFailure('');
                  try {
                    await api(`/events/${eventId}/participation`, {
                      method: 'POST',
                      body: JSON.stringify({
                        attending: true,
                        absenceIds: state.absences.map((a) => a.id),
                      }),
                    });
                    setDialog(null);
                    changed();
                  } catch (err) {
                    setFailure(updateError(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Отменить заявки и участвовать
              </Button>
            </div>
          </Stack>
        </Modal>
      )}
    </div>
  );
}
