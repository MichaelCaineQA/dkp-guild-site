'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { DashboardEvent, EventScopeInput } from '@dkp/shared';
import { api } from '../lib/api';
import { Button, ErrorText, Modal, Stack } from './ui';
import { EventScopeFields, type EventScopeGroup } from './event-scope-fields';

export function EditEventScopeDialog({
  event,
  onClose,
  onChanged,
}: {
  event: DashboardEvent;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [value, setValue] = useState<EventScopeInput>({
    scope: event.scope,
    kpId: event.kpId,
    packId: event.packId,
  });
  const [groups, setGroups] = useState<EventScopeGroup[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ groups: EventScopeGroup[] }>('/org/roster')
      .then((org) => {
        if (active) setGroups(org.groups);
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить состав');
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/events/${event.id}`, { method: 'PATCH', body: JSON.stringify(value) });
      onChanged();
      onClose();
    } catch {
      setError('Не удалось изменить состав. Проверьте группу и статус ивента.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Изменить состав" onClose={onClose}>
      <form onSubmit={submit}>
        <Stack>
          {groups && <EventScopeFields value={value} groups={groups} onChange={setValue} />}
          {error && <ErrorText>{error}</ErrorText>}
          <Button type="submit" variant="primary" disabled={busy || !groups}>
            Сохранить состав
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
