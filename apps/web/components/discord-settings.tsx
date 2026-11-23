'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button, Card, ErrorText, Field, Input, Muted, SectionTitle } from './ui';

type Kind = 'announcements' | 'reminders' | 'absences' | 'lots';
type Channels = Record<Kind, string | null>;
type Settings = { channels: Channels; configured: boolean };
const labels: Record<Kind, string> = {
  announcements: 'Анонсы ивентов',
  reminders: 'Напоминания',
  absences: 'Заявки об отсутствии',
  lots: 'Итоги лотов',
};

export function DiscordSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [testId, setTestId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<Settings>('/settings/discord')
      .then((result) => {
        if (active) setSettings(result);
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить настройки Discord');
      });
    return () => {
      active = false;
    };
  }, []);
  const errorText = (err: unknown) => {
    const body = (err as { body?: { message?: unknown } }).body;
    return typeof body?.message === 'string' ? body.message : 'Не удалось выполнить действие';
  };
  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<Settings>('/settings/discord', {
        method: 'PUT',
        body: JSON.stringify({
          channels: settings.channels,
          absenceAccessConfirmed: confirmed,
          reason,
        }),
      });
      setSettings(result);
      setReason('');
      setConfirmed(false);
      setMessage('Каналы сохранены');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const test = async (kind: Kind) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ id: string }>(`/settings/discord/test/${kind}`, {
        method: 'POST',
      });
      setTestId(result.id);
      setMessage('Проверка поставлена в очередь. Проверьте статус.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const status = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ status: string; lastError: string | null }>(
        `/settings/discord/test/${testId}`,
      );
      setMessage(
        result.status === 'SENT'
          ? 'Тестовое сообщение доставлено в Discord.'
          : result.status === 'FAILED'
            ? `Ошибка доставки: ${result.lastError ?? 'неизвестная ошибка'}`
            : 'Сообщение ожидает отправки.',
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mb-4">
      <SectionTitle>Discord</SectionTitle>
      <div className="space-y-4">
        {settings && !settings.configured && (
          <div>
            <Muted>Бот или сервер Discord ещё не настроен в окружении.</Muted>
          </div>
        )}
        {settings && (
          <>
            <Muted>
              Укажите ID текстовых каналов. Пустое поле отключает уведомления этого типа.
            </Muted>
            {(Object.keys(labels) as Kind[]).map((kind) => (
              <div key={kind} className="space-y-2">
                <Field label={labels[kind]}>
                  <Input
                    value={settings.channels[kind] ?? ''}
                    inputMode="numeric"
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        channels: { ...settings.channels, [kind]: event.target.value || null },
                      })
                    }
                  />
                </Field>
                <Button disabled={busy || !settings.channels[kind]} onClick={() => void test(kind)}>
                  Проверить сохранённый канал
                </Button>
              </div>
            ))}
            <Field label="Подтверждаю: канал отсутствий закрыт для остальных, доступен офицерам и всем назначенным РЛ">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
            </Field>
            <Field label="Причина изменения">
              <Input
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <Button disabled={busy || !reason.trim()} onClick={() => void save()}>
              Сохранить каналы
            </Button>
            {testId && (
              <Button disabled={busy} onClick={() => void status()}>
                Проверить статус сообщения
              </Button>
            )}
          </>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        {message && <p role="status">{message}</p>}
      </div>
    </Card>
  );
}
