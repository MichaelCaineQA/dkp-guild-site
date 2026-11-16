import type { ReactNode } from 'react';

/** Шапка переносит навигацию и блок пользователя на узком экране. */
export function SiteHeader({
  navigation,
  children,
}: {
  navigation: ReactNode;
  children: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface py-3.5 px-6 shadow-sm">
      {navigation}
      <div className="flex min-w-0 flex-wrap items-center gap-4">{children}</div>
    </header>
  );
}

/** Вертикальная группа блоков страницы или формы. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-6">{children}</div>;
}

/**
 * UI-примитивы (components/ui) — ЕДИНСТВЕННОЕ место, где появляется вёрстка
 * и стили. Страницы собирают экраны из этих блоков и не пишут стилей сами.
 */

/** Обёртка страницы: центрирует контент, задаёт поля и ширину. */
export function Page({
  children,
  width = 'regular',
}: {
  children: ReactNode;
  width?: 'narrow' | 'regular' | 'wide';
}) {
  const max = width === 'narrow' ? 'max-w-xl' : width === 'wide' ? 'max-w-7xl' : 'max-w-6xl';
  return <main className={`mx-auto w-full ${max} px-6 py-8 sm:px-8`}>{children}</main>;
}

/** Заголовок страницы + необязательное пояснение. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8 border-b border-line/60 pb-5">
      <h1 className="text-3xl font-bold text-primary tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-xs text-text-muted leading-relaxed">{subtitle}</p>}
    </header>
  );
}

/** Карточка — основной контейнер контента. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-6 shadow-card ${className}`}>
      {children}
    </section>
  );
}

/** Заголовок секции внутри карточки/страницы. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-xs font-bold text-primary uppercase tracking-wider">{children}</h2>;
}

/** Строка состояния: приглашение войти, пояснение про доступ. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success' | 'danger';
  children: ReactNode;
}) {
  const tones = {
    info: 'border-line bg-surface-elevated text-text-secondary',
    success: 'border-status-success/30 bg-status-success-bg text-status-success',
    danger: 'border-status-danger/30 bg-status-danger-bg text-status-danger',
  };
  return <div className={`rounded-xl border p-4 text-xs font-medium ${tones[tone]}`}>{children}</div>;
}

/** Текст ошибки. */
export function ErrorText({ children }: { children: ReactNode }) {
  return <span className="text-status-danger text-xs font-medium">{children}</span>;
}

/** Приглушённый текст — пояснения, счётчики, пустые значения. */
export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-text-muted text-xs">{children}</span>;
}