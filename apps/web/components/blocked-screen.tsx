'use client';

import { useState } from 'react';
import { api } from '../lib/api';
import { Button, Card, Page } from './ui';

/**
 * Экран заблокированной учётки (issue #149): без шапки и навигации, любой
 * прямой URL показывает только его — API для заблокированных закрыт, кроме
 * /auth/me и выхода. Кнопка «Выйти» — не навигация: без неё человек навсегда
 * заперт в этой сессии на чужом устройстве.
 */
export function BlockedScreen() {
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      window.location.href = '/';
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page width="narrow">
      <Card className="mt-16 text-center">
        <h1 className="text-2xl font-semibold text-primary">Гильдия закрыла свои врата для тебя</h1>
        <p className="mt-3 text-secondary">
          Твоя учётная запись заблокирована. Если вернёшься в гильдию, руководство восстановит
          доступ — история ДКП, класса и выкупленных лотов сохранена.
        </p>
        <p className="mt-2 text-sm text-secondary">Вход в гильдию — через руководство в игре.</p>
        <Button className="mt-6" variant="secondary" onClick={logout} disabled={busy}>
          Выйти
        </Button>
      </Card>
    </Page>
  );
}
