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
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] ${wide ? 'max-w-xl' : 'max-w-sm'} overflow-y-auto rounded-xl border border-line-subtle bg-surface-elevated p-6 sm:p-8 text-primary shadow-[0_24px_64px_rgba(2,5,16,0.65)] shadow-glow-purple backdrop:bg-black/70`}
    >
      {heading && <h2 className="mb-4 text-xl font-semibold">{title}</h2>}
      {children}
    </dialog>
  );
}
