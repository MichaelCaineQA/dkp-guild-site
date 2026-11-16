'use client';
import { useState, type FormEvent } from 'react';
import { addGearScoreSchema, SCREENSHOT_MAX_BYTES, SCREENSHOT_MIME_TYPES } from '@dkp/shared';
import { api } from '../lib/api';
import { Button, Card, ErrorText, Field, Input, Notice, SectionTitle, Stack } from './ui';
import { ScreenshotLinks } from './onboarding';

export function GearScoreEditor({
  memberId,
  onSaved,
}: {
  memberId: string;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        if (
          file.size > SCREENSHOT_MAX_BYTES ||
          !SCREENSHOT_MIME_TYPES.includes(file.type as (typeof SCREENSHOT_MIME_TYPES)[number])
        )
          throw new Error('Выберите PNG, JPG/JPEG или WebP до 10 МБ включительно.');
        const body = new FormData();
        body.append('file', file);
        const result = await api<{ id: string }>('/screenshots', { method: 'POST', body });
        setIds((current) => [...current, result.id]);
      }
    } catch {
      setError('Не удалось загрузить скриншот. Выберите корректное изображение до 10 МБ.');
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = addGearScoreSchema.safeParse({
      gearScore: Number(value),
      screenshotIds: ids,
      comment,
    });
    if (!parsed.success) {
      setError('Укажите положительный целый GS, скриншот и комментарий от 3 до 500 символов.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/profiles/${encodeURIComponent(memberId)}/gear-score`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      await onSaved();
      setIds([]);
      setValue('');
      setComment('');
      setMessage('GS обновлён');
    } catch {
      setError('Не удалось обновить GS. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <SectionTitle>Обновить GS</SectionTitle>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <Stack>
            <Field label="Новое значение GS">
              <Input
                type="number"
                min="1"
                step="1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Field label="Скриншоты с ником и GS">
              <Input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void upload(e.target.files)}
              />
            </Field>
            <ScreenshotLinks ids={ids} />
            {!!ids.length && (
              <Button type="button" onClick={() => setIds([])}>
                Очистить выбор скриншотов
              </Button>
            )}
            <Field label="Причина обновления GS">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            {error && <ErrorText>{error}</ErrorText>}
            {message && <Notice>{message}</Notice>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Сохранение…' : 'Сохранить GS'}
            </Button>
          </Stack>
        </fieldset>
      </form>
    </Card>
  );
}
