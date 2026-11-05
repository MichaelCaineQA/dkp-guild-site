'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Input, Notice, Page, PageHeader } from '../../components/ui';

/** Заявка на привязку Discord-аккаунта к нику члена гильдии (план 2.9). */
export default function LinkPage() {
  const [nickname, setNickname] = useState('');
  const [result, setResult] = useState<'idle' | 'ok' | 'error'>('idle');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult('idle');
    try {
      await api('/auth/link-request', {
        method: 'POST',
        body: JSON.stringify({ nickname }),
      });
      setResult('ok');
    } catch {
      setResult('error');
    }
  };

  return (
    <Page width="narrow">
      <PageHeader
        title="Привязка игрового ника"
        subtitle="Твой Discord пока не связан с профилем члена гильдии"
      />
      <Card>
        <p className="text-sm text-secondary">
          Укажи игровой ник — офицер подтвердит заявку, и профили объединятся.
        </p>
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={submit}>
          <Input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="Игровой ник"
            minLength={2}
            maxLength={40}
            required
          />
          <Button type="submit" variant="primary" disabled={nickname.length < 2}>
            Отправить заявку
          </Button>
        </form>
        {result === 'ok' && (
          <Notice tone="success" >✅ Заявка отправлена — дождись подтверждения офицера.</Notice>
        )}
        {result === 'error' && <Notice tone="danger">❌ Не получилось (возможно, заявка уже отправлена).</Notice>}
      </Card>
    </Page>
  );
}
