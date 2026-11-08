'use client';
import { useEffect, useState } from 'react';
import { guildNameSchema } from '@dkp/shared';
import { api, API_URL_VALUE } from '../lib/api';
import { Button, Card, ErrorText, Field, GuildBrand, Input, Muted, SectionTitle } from './ui';

export function GuildSettings() {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hasCrest, setHasCrest] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ name: string; hasCrest: boolean }>('/meta/guild')
      .then((data) => {
        if (active) {
          setName(data.name);
          setHasCrest(data.hasCrest);
        }
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить настройки гильдии');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const save = async () => {
    const parsed = guildNameSchema.safeParse(name);
    if (
      !parsed.success ||
      (file && (file.size > 2 * 1024 * 1024 || !['image/png', 'image/webp'].includes(file.type)))
    ) {
      setError('Проверьте название и файл PNG/WebP до 2 МБ.');
      return;
    }
    const form = new FormData();
    form.set('name', parsed.data);
    if (file) form.set('file', file);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ name: string; hasCrest: boolean }>('/settings/guild', {
        method: 'PUT',
        body: form,
      });
      setName(result.name);
      setHasCrest(result.hasCrest);
      setFile(null);
      setVersion(Date.now());
      window.dispatchEvent(new Event('guild:changed'));
      setMessage('Настройки гильдии сохранены');
    } catch {
      setError('Не удалось сохранить. Проверьте прозрачность герба и попробуйте снова.');
    } finally {
      setBusy(false);
    }
  };
  const source =
    preview ?? (hasCrest ? `${API_URL_VALUE}/settings/guild/crest?v=${version}` : null);
  return (
    <Card className="mb-4">
      <SectionTitle>Гильдия</SectionTitle>
      <div className="space-y-3">
        <Field label="Название гильдии">
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Герб">
          <Input
            type="file"
            accept="image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <Muted>PNG или WebP с прозрачностью, до 2 МБ и 1024 × 1024 пикселей.</Muted>
        <div className="flex items-center gap-3 rounded-lg bg-surface-muted p-3">
          <GuildBrand name={name || 'Гильдия'} crestUrl={source} />
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        {message && <p role="status">{message}</p>}
        <Button onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'Сохранение…' : 'Сохранить гильдию'}
        </Button>
      </div>
    </Card>
  );
}
