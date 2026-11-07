'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

interface PlayerCheckInView {
  phase: 'START' | 'END';
  windowState: 'NOT_OPEN_YET' | 'ACTIVE' | 'CLOSED';
  choices: string[];
  status: string;
}

/**
 * Чек-ин игрока в карточке ивента (план 2.2): кнопка «Отметиться»
 * активна в окне; 4 кода → модалка подтверждения → одна попытка.
 */
export function CheckInPanel({ eventId }: { eventId: string }) {
  const [view, setView] = useState<PlayerCheckInView | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // выбор до модалки
  const [result, setResult] = useState<'PASSED' | 'FAILED' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<PlayerCheckInView>(`/events/${eventId}/checkin/me`);
      setView(data);
      setError(null);
    } catch {
      setError('Чек-ин недоступен');
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    // Обновляем статус окна раз в 10 сек: окно открывается/закрывается само.
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const confirm = async () => {
    if (picked === null) {
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ result: 'PASSED' | 'FAILED' }>(`/events/${eventId}/checkin/me`, {
        method: 'POST',
        body: JSON.stringify({ code: picked }),
      });
      setResult(data.result);
      if (data.result === 'PASSED') window.dispatchEvent(new Event('dkp:changed'));
      setPicked(null);
      await load();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 409 ? 'Попытка уже использована или окно закрыто' : 'Не удалось отправить код',
      );
      setPicked(null);
    } finally {
      setBusy(false);
    }
  };

  if (error && !view) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!view) {
    return null;
  }

  const phaseLabel = view.phase === 'START' ? 'старт' : 'финал';

  if (result === 'PASSED') {
    return <p className="text-sm text-success">✅ Отмечены ({phaseLabel}) — ДКП начислены</p>;
  }
  if (result === 'FAILED') {
    return (
      <p className="text-sm text-danger">
        ❌ Неверный код: попытка потрачена, дальше — только ручная отметка РЛ
      </p>
    );
  }

  if (view.status === 'PASSED') {
    return <p className="text-sm text-success">✅ Уже отмечены ({phaseLabel})</p>;
  }
  if (view.status === 'FAILED') {
    return <p className="text-sm text-danger">❌ Попытка использована ({phaseLabel})</p>;
  }

  if (view.windowState === 'NOT_OPEN_YET') {
    return <p className="text-sm text-secondary">Окно чек-ина ({phaseLabel}) ещё не открылось</p>;
  }
  if (view.windowState === 'CLOSED') {
    return <p className="text-sm text-secondary">Окно чек-ина ({phaseLabel}) закрыто</p>;
  }

  return (
    <div className="mt-3">
      <p className="mb-2 text-sm font-semibold">Отметиться кодом ({phaseLabel}):</p>
      <div className="flex flex-wrap gap-2">
        {view.choices.map((code) => (
          <button
            key={code}
            type="button"
            disabled={busy}
            onClick={() => setPicked(code)}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-lg font-semibold tabular-nums hover:bg-surface-muted"
          >
            {code}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}

      {/* Модалка подтверждения (план 2.2): случайный клик не тратит попытку */}
      {picked !== null && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPicked(null)}
        >
          <div
            className="w-full max-w-xs rounded-xl border border-line bg-surface p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-lg font-semibold">Код {picked} — подтвердить?</p>
            <p className="mt-1 text-center text-xs text-secondary">
              Попытка одна: ошибётесь — отметит только РЛ вручную
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={confirm}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover"
              >
                Подтвердить
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPicked(null)}
                className="rounded-lg border border-line bg-surface px-4 py-1.5 text-sm hover:bg-surface-muted"
              >
                Назад
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface RaidLeadCheckInView {
  phase: 'START' | 'END';
  windowState: 'NOT_OPEN_YET' | 'ACTIVE' | 'CLOSED';
  code: string;
  windowOpensAt: string;
  windowClosesAt: string;
}

/** Блок РЛ в карточке ивента: крупный код и статус окна (план 2.2). */
export function RaidLeadCodePanel({ eventId }: { eventId: string }) {
  const [view, setView] = useState<RaidLeadCheckInView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<RaidLeadCheckInView>(`/events/${eventId}/checkin/code`);
      setView(data);
      setError(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 403 ? 'Код доступен РЛ ивента и офицерам' : 'Код недоступен');
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) {
    return null; // не РЛ — блок не показываем
  }
  if (!view) {
    return null;
  }

  const phaseLabel = view.phase === 'START' ? 'старт' : 'финал';

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-muted p-3">
      <p className="text-xs font-semibold text-secondary">
        Код чек-ина ({phaseLabel}) — назовите в голосовом чате
      </p>
      {view.windowState === 'ACTIVE' ? (
        <p className="text-4xl font-bold tracking-widest tabular-nums">{view.code}</p>
      ) : view.windowState === 'NOT_OPEN_YET' ? (
        <p className="text-sm text-secondary">
          Окно откроется {new Date(view.windowOpensAt).toLocaleTimeString('ru-RU')} — код появится
          здесь
        </p>
      ) : (
        <p className="text-sm text-secondary">Окно закрылось</p>
      )}
      {view.windowState === 'ACTIVE' && (
        <p className="text-xs text-secondary">
          до {new Date(view.windowClosesAt).toLocaleTimeString('ru-RU')}
        </p>
      )}
    </div>
  );
}
