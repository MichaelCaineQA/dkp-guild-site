import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/** Кнопка. variant: primary — основное действие, secondary — обычное, danger — разрушительное. */
export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const variants = {
    // Основное действие — золотой градиент с тёмным текстом и тёплым свечением
    primary:
      'bg-[linear-gradient(135deg,var(--btn-gold-from),var(--btn-gold-to))] text-btn-gold-text shadow-sm hover:shadow-glow-gold hover:brightness-105 active:translate-y-px',
    // Обычное — тёмная плашка с рамкой, подсветка рамки акцентом при наведении
    secondary:
      'border border-line bg-surface-elevated text-primary hover:border-line-accent hover:bg-surface-hover',
    // Разрушительное — мягкая красная подложка
    danger:
      'border border-danger/30 bg-danger-soft text-danger hover:border-danger/60 hover:bg-danger/20',
  };
  return (
    <button
      className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

/** Поле ввода текста. */
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-w-0 max-w-full rounded-xl border border-line bg-surface-elevated px-3 py-2 text-xs text-primary placeholder:text-text-muted focus:border-cyan-accent focus:outline-none transition-colors ${className}`}
      {...props}
    />
  );
}

/** Выпадающий список. */
export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`dkp-select cursor-pointer rounded-xl border border-line bg-surface-elevated px-3 py-2 text-xs text-primary transition-colors hover:border-line-accent focus:border-cyan-accent focus:outline-none ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

/** Подпись + контрол в одну строку (для компактных форм и фильтров). */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-secondary font-medium">
      {label}
      {children}
    </label>
  );
}

export function TextLink({ className = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={`text-cyan-accent hover:underline text-xs font-medium transition-colors ${className}`} {...props} />;
}

export function RosterTabs({
  requests,
  current,
}: {
  requests: boolean;
  current: 'members' | 'requests';
}) {
  return (
    <nav aria-label="Вкладки состава" className="mb-6 flex gap-2 bg-surface-elevated p-1 rounded-xl border border-line w-fit">
      <a
        href="/roster"
        aria-current={current === 'members' ? 'page' : undefined}
        className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          current === 'members'
            ? 'bg-accent-soft text-accent shadow-sm'
            : 'text-text-secondary hover:text-primary'
        }`}
      >
        Участники
      </a>
      {requests && (
        <a
          href="/link-requests"
          aria-current={current === 'requests' ? 'page' : undefined}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            current === 'requests'
              ? 'bg-accent-soft text-accent shadow-sm'
              : 'text-text-secondary hover:text-primary'
        }`}
      >
          Заявки
        </a>
      )}
    </nav>
  );
}