'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Modal, Button, Stack, Muted } from './ui';

interface PlayerCheckInView {
  phase: 'START' | 'END';
  windowState: 'NOT_OPEN_YET' | 'ACTIVE' | 'CLOSED';
  choices: string[];
  status: string;
}

/** Окно финала закрыто — позже этой фазы ничего не откроется, опрос не нужен. */
function isSettled(view: { phase: string; windowState: string } | null): boolean {
  return view !== null && view.phase === 'END' && view.windowState === 'CLOSED';
}

/**
 * Чек-ин игрока в карточке ивента (план 2.2): кнопка «Отметиться»
 * активна в окне; 4 кода → модалка подтверждения → одна попытка.
 */
export function CheckInPanel({ eventId }: { eventId: string }) {
  const [view, setView] = useState<PlayerCheckInView | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // выбор до модалки
  const [result, setResult] = useState<{
    phase: PlayerCheckInView['phase'];
    status: 'PASSED' | 'FAILED';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Последний ответ сервера — по нему решаем, продолжать ли опрос. */
  const latest = useRef<PlayerCheckInView | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<PlayerCheckInView>(`/events/${eventId}/checkin/me`);
      latest.current = data;
      setView(data);
      setError(null);
    } catch (err) {
      setError(
        (err as { status?: number }).status === 429
          ? 'Слишком много запросов. Статус чек-ина обновится автоматически.'
          : 'Чек-ин недоступен',
      );
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    // Обновляем статус окна раз в 10 сек: окно открывает кнопка управляющего.
    const timer = setInterval(() => {
      if (!isSettled(latest.current)) void load();
    }, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const confirm = async () => {
    if (picked === null || !view) {
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const data = await api<{ result: 'PASSED' | 'FAILED' }>(`/events/${eventId}/checkin/me`, {
        method: 'POST',
        body: JSON.stringify({ code: picked }),
      });
      setResult({ phase: view.phase, status: data.result });
      if (data.result === 'PASSED') window.dispatchEvent(new Event('dkp:changed'));
      setPicked(null);
      await load();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setSubmitError(
        status === 429
          ? 'Слишком много запросов. Повторите отправку кода через минуту, если окно ещё открыто.'
          : status === 409
            ? 'Попытка уже использована или окно закрыто'
            : 'Не удалось отправить код',
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

  if (result?.phase === view.phase && result.status === 'PASSED') {
    return <p className="text-sm text-success">✅ Отмечены ({phaseLabel}) — ДКП начислены</p>;
  }
  if (result?.phase === view.phase && result.status === 'FAILED') {
    return (
      <p className="text-sm text-danger">
        ❌ Неверный код. Попросите управляющего ивентом отметить участие вручную.
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
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              setPicked(code);
            }}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-lg font-semibold tabular-nums hover:bg-surface-muted"
          >
            {code}
          </button>
        ))}
      </div>
      {(submitError || error) && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {submitError ?? error}
        </p>
      )}

      {/* Модалка подтверждения (план 2.2): случайный клик не тратит попытку */}
      {picked !== null && (
        <Modal
          title={`Код ${picked} — подтвердить?`}
          onClose={() => {
            if (!busy) setPicked(null);
          }}
        >
          <Stack>
            <Muted>Попытка одна. После ошибки участие отмечают вручную.</Muted>
            <Button type="button" disabled={busy} onClick={confirm}>
              Подтвердить
            </Button>
            <Button type="button" disabled={busy} onClick={() => setPicked(null)}>
              Назад
            </Button>
          </Stack>
        </Modal>
      )}
    </div>
  );
}

interface RaidLeadCheckInView {
  phase: 'START' | 'END';
  windowState: 'NOT_OPEN_YET' | 'ACTIVE' | 'CLOSED';
  code: string;
  /** null — код этой фазы ещё не запускали. */
  windowOpensAt: string | null;
  windowClosesAt: string | null;
}

/**
 * Блок управляющего в карточке ивента и на странице проведения: крупный код
 * и статус окна (план 2.2). Окно открывают кнопки «Начать ивент» и «Завершить
 * ивент»; `reloadSignal` перечитывает код сразу после нажатия, не дожидаясь
 * опроса.
 */
export function RaidLeadCodePanel({
  eventId,
  reloadSignal = 0,
}: {
  eventId: string;
  reloadSignal?: number;
}) {
  const [view, setView] = useState<RaidLeadCheckInView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<RaidLeadCheckInView | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<RaidLeadCheckInView>(`/events/${eventId}/checkin/code`);
      latest.current = data;
      setView(data);
      setError(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 403 ? 'Код доступен РЛ ивета и офицерам' : 'Код недоступен');
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    // Код виден ограниченное время: следим за окном раз в 10 сек.
    const timer = setInterval(() => {
      if (!isSettled(latest.current)) void load();
    }, 10_000);
    return () => clearInterval(timer);
  }, [load, reloadSignal]);

  if (error) {
    return null; // не управляющий — блок не показываем
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
        <>
          <p className="text-4xl font-bold tracking-widest tabular-nums">{view.code}</p>
          {view.windowClosesAt && (
            <p className="text-xs text-secondary">
              до {new Date(view.windowClosesAt).toLocaleTimeString('ru-RU')}
            </p>
          )}
        </>
      ) : view.windowState === 'NOT_OPEN_YET' ? (
        <p className="text-sm text-secondary">
          Окно стартового кода откроется кнопкой «Начать ивент» — код появится здесь
        </p>
      ) : view.code ? (
        <p className="text-sm text-secondary">Окно закрылось</p>
      ) : (
        <p className="text-sm text-secondary">Код не запускался</p>
      )}
    </div>
  );
}
