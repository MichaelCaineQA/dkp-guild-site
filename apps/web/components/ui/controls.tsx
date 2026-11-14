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
    primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
    secondary: 'border border-line bg-surface text-primary hover:bg-surface-muted',
    danger: 'bg-danger text-white hover:opacity-90',
  };
  return (
    <button
      className={`rounded-lg px-4 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

/** Поле ввода текста. */
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-w-0 max-w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-primary placeholder:text-disabled focus:border-accent focus:outline-none ${className}`}
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
      className={`rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-primary focus:border-accent focus:outline-none ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

/** Подпись + контрол в одну строку (для компактных форм и фильтров). */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-secondary">
      {label}
      {children}
    </label>
  );
}

export function TextLink({ className = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={`text-accent underline ${className}`} {...props} />;
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
  return (
    <nav aria-label="Вкладки состава" className="mb-4 flex flex-wrap gap-4">
      <TextLink href="/roster" aria-current={current === 'members' ? 'page' : undefined}>
        Участники
      </TextLink>
      <TextLink href="/roster/kp" aria-current={current === 'kp' ? 'page' : undefined}>
        КП
      </TextLink>
      <TextLink href="/roster/pack" aria-current={current === 'pack' ? 'page' : undefined}>
        Пак
      </TextLink>
      {requests && (
        <TextLink href="/link-requests" aria-current={current === 'requests' ? 'page' : undefined}>
          Заявки
        </TextLink>
      )}
      {blocked && (
        <TextLink href="/roster/blocked" aria-current={current === 'blocked' ? 'page' : undefined}>
          Заблокированные
        </TextLink>
      )}
    </nav>
  );
}
