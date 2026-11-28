'use client';
import { useState, type FormEvent } from 'react';
import { updateEventSchema, type DashboardEvent } from '@dkp/shared';
import { api } from '../lib/api';
import { Button, ErrorText, Field, Input, Modal, Stack } from './ui';

export function EditEventRewardDialog({
  event,
  onClose,
  onChanged,
}: {
  event: DashboardEvent;
  onClose: () => void;
  onChanged: (dkpReward: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const dkpReward = Number(new FormData(e.currentTarget).get('dkpReward'));
    const valid = updateEventSchema.shape.dkpReward.safeParse(dkpReward);
    if (!valid.success) {
      setError('Введите целое число от 1 до 2 147 483 647.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/events/${event.id}`, { method: 'PATCH', body: JSON.stringify({ dkpReward }) });
      onChanged(dkpReward);
      onClose();
    } catch (err) {
      setError(
        (err as { status?: number }).status === 409
          ? 'Плату ДКП можно менять только до начала ивента.'
          : 'Не удалось сохранить плату ДКП.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Изменить плату ДКП" onClose={onClose}>
      <form onSubmit={submit}>
        <Stack>
          <Field label="Плата ДКП">
            <Input
              name="dkpReward"
              type="number"
              defaultValue={event.dkpReward}
              min="1"
              step="1"
              required
              disabled={busy}
            />
          </Field>
          {error && (
            <div role="alert">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            Сохранить плату
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
