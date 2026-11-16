import type { ReactNode } from 'react';

/**
 * Шапка переносит навигацию и блок пользователя на узком экране.
 * На телефоне — два компактных ряда: герб, игровое время и тема; ниже —
 * баланс, игрок, ранг и выход (этап 5, мобильная доводка).
 */
export function SiteHeader({
  navigation,
  children,
}: {
  navigation: ReactNode;
  children: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface px-4 shadow-sm md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 md:gap-4 md:py-3">
        <div className="min-w-0 max-md:flex-1 max-md:pl-12">{navigation}</div>
        <div className="contents md:flex md:min-w-0 md:flex-wrap md:items-center md:gap-3">
          {children}
        </div>
      </div>
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
  return <main className={`mx-auto w-full ${max} px-4 py-6 sm:px-8 sm:py-8`}>{children}</main>;
}

/** Заголовок страницы + необязательное пояснение. */
export function PageHeader({ title, subtitle }: { title: ReactNode; subtitle?: string }) {
  return (
    <header className="mb-8 border-b border-line/60 pb-5">
      <h1 className="text-3xl font-bold text-primary tracking-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-xs text-text-muted leading-relaxed">{subtitle}</p>}
    </header>
  );
}

/** Карточка — основной контейнер контента. id — якорь перехода (срезы статистики). */
export function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

/** Заголовок секции внутри карточки/страницы. */
export function SectionTitle({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 className={`mb-4 text-sm font-bold tracking-wider text-primary uppercase ${className}`}>
      {children}
    </h2>
  );
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
    success: 'border-status-success/30 bg-success-soft text-status-success',
    danger: 'border-status-danger/30 bg-danger-soft text-status-danger',
  };
  return (
    <div className={`rounded-xl border p-4 text-xs font-medium ${tones[tone]}`}>{children}</div>
  );
}

/** Текст ошибки. */
export function ErrorText({ children }: { children: ReactNode }) {
  return <span className="text-status-danger text-xs font-medium">{children}</span>;
}

/** Приглушённый текст — пояснения, счётчики, пустые значения. */
export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-text-muted text-xs">{children}</span>;
}
