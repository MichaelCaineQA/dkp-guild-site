'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './controls';
import { ErrorText, Stack } from './layout';
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  heading = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  heading?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => {
      node?.close?.();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        // Escape закрывает только верхнее окно, например подтверждение чек-ина.
        e.stopPropagation();
        onClose();
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-1rem)] ${wide ? 'max-w-xl' : 'max-w-sm'} overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-4 text-primary backdrop:bg-black/60 md:w-[calc(100%-2rem)] md:p-6`}
    >
      <button
        type="button"
        aria-label="Закрыть окно"
        onClick={onClose}
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-secondary hover:bg-surface-muted hover:text-primary md:right-3 md:top-3 md:h-8 md:w-8"
      >
        ×
      </button>
      {heading && <h2 className="mb-4 pr-10 text-xl font-semibold md:pr-8">{title}</h2>}
      {children}
    </dialog>
  );
}

/**
 * Подтверждение действия, которое нельзя отменить: окно с пояснением,
 * основной кнопкой и «Отменой». Пока действие выполняется, окно не закрывается.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <Stack>
        {children}
        {error && (
          <div role="alert">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </Stack>
    </Modal>
  );
}
