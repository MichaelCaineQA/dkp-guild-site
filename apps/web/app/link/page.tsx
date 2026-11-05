'use client';

import { useState } from 'react';
import { api } from '../../lib/api';

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
    <main style={{ padding: 24, maxWidth: 480 }}>
      <h1>Привязка игрового ника</h1>
      <p>
        Твой Discord пока не связан с профилем члена гильдии. Укажи игровой ник —
        офицер подтвердит заявку, и профили объединятся.
      </p>
      <form onSubmit={submit}>
        <input
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="Игровой ник"
          minLength={2}
          maxLength={40}
          required
        />
        <button type="submit" disabled={nickname.length < 2}>
          Отправить заявку
        </button>
      </form>
      {result === 'ok' && <p>✅ Заявка отправлена — дождись подтверждения офицера.</p>}
      {result === 'error' && <p>❌ Не получилось (возможно, заявка уже отправлена).</p>}
    </main>
  );
}
