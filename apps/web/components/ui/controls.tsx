import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/*
 * Телефон (экран уже md): цель касания у кнопок и полей — не меньше 44px,
 * текст полей — 16px, иначе iOS Safari приближает страницу при фокусе
 * (этап 5, мобильная доводка). На компьютере размеры прежние.
 */
const TOUCH_TARGET = 'min-h-11 md:min-h-0';
const FIELD_TEXT = 'text-base md:text-sm';

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
      className={`${TOUCH_TARGET} rounded-xl px-5 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

/** Поле ввода текста. */
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`${TOUCH_TARGET} min-w-0 max-w-full rounded-xl border border-line bg-surface-elevated px-3 py-2 ${FIELD_TEXT} text-primary placeholder:text-text-muted focus:border-cyan-accent focus:outline-none transition-colors ${className}`}
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
      className={`${TOUCH_TARGET} dkp-select min-w-0 max-w-full cursor-pointer rounded-xl border border-line bg-surface-elevated px-3 py-2 ${FIELD_TEXT} text-primary transition-colors hover:border-line-accent focus:border-cyan-accent focus:outline-none ${className}`}
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
  return (
    <a
      className={`text-cyan-accent hover:underline text-xs font-medium transition-colors ${className}`}
      {...props}
    />
  );
}
export function RosterTabs({
  requests = false,
  blocked = false,
  current,
}: {
  requests?: boolean;
  /** Вкладка «Заблокированные» — только Главе/Админу (issue #149). */
  blocked?: boolean;
  current: 'members' | 'kp' | 'pack' | 'requests' | 'blocked';
}) {
  const tabs = [
    { key: 'members', label: 'Участники', href: '/roster', visible: true },
    { key: 'kp', label: 'КП', href: '/roster/kp', visible: true },
    { key: 'pack', label: 'Пак', href: '/roster/pack', visible: true },
    { key: 'requests', label: 'Заявки', href: '/link-requests', visible: requests },
    { key: 'blocked', label: 'Заблокированные', href: '/roster/blocked', visible: blocked },
  ];
  return (
    <nav
      aria-label="Вкладки состава"
      className="mb-6 flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-line bg-surface-elevated p-1"
    >
      {tabs
        .filter((tab) => tab.visible)
        .map((tab) => (
          <a
            key={tab.key}
            href={tab.href}
            aria-current={current === tab.key ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors md:min-h-0 ${current === tab.key ? 'bg-accent-soft text-accent shadow-sm' : 'text-secondary hover:text-primary'}`}
          >
            {tab.label}
          </a>
        ))}
    </nav>
  );
}
