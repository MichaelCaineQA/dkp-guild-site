import type { ReactNode } from 'react';

/**
 * UI-примитивы (components/ui) — ЕДИНСТВЕННОЕ место, где появляется вёрстка
 * и стили. Страницы собирают экраны из этих блоков и не пишут стилей сами —
 * поэтому перевёрстка под новый дизайн = правка этого каталога и палитры,
 * а страницы (данные, обработчики, права) не меняются. Спецификация —
 * apps/web/DESIGN.md.
 */

/** Обёртка страницы: центрирует контент, задаёт поля и ширину. */
export function Page({ children, width = 'regular' }: { children: ReactNode; width?: 'narrow' | 'regular' | 'wide' }) {
  const max = width === 'narrow' ? 'max-w-xl' : width === 'wide' ? 'max-w-6xl' : 'max-w-3xl';
  return (
    <main className={`mx-auto w-full ${max} px-4 py-6 sm:px-6`}>
      {children}
    </main>
  );
}

/** Заголовок страницы + необязательное пояснение. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-semibold text-primary">{title}</h1>
      {subtitle && <p className="mt-1 text-secondary">{subtitle}</p>}
    </header>
  );
}

/** Карточка — основной контейнер контента. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

/** Заголовок секции внутри карточки/страницы. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-lg font-semibold text-primary">{children}</h2>;
}

/** Строка состояния: приглашение войти, пояснение про доступ. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'danger'; children: ReactNode }) {
  const tones = {
    info: 'border-line bg-surface-muted text-secondary',
    success: 'border-success/40 bg-success-soft text-success',
    danger: 'border-danger/40 bg-danger-soft text-danger',
  };
  return <p className={`rounded-lg border p-3 ${tones[tone]}`}>{children}</p>;
}

/** Текст ошибки. */
export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-danger">{children}</p>;
}

/** Приглушённый текст — пояснения, счётчики, пустые значения. */
export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-secondary">{children}</span>;
}
