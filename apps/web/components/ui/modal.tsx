'use client';
import { useEffect, useRef, type ReactNode } from 'react';
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
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] ${wide ? 'max-w-xl' : 'max-w-sm'} overflow-y-auto rounded-xl border border-line bg-surface p-6 text-primary backdrop:bg-black/60`}
    >
      <button
        type="button"
        aria-label="Закрыть окно"
        onClick={onClose}
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-xl leading-none text-secondary hover:bg-surface-muted hover:text-primary"
      >
        ×
      </button>
      {heading && <h2 className="mb-4 pr-8 text-xl font-semibold">{title}</h2>}
      {children}
    </dialog>
  );
}
