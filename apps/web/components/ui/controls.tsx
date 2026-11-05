import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

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
      className={`rounded-card px-4 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

/** Поле ввода текста. */
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-card border border-line bg-surface px-3 py-1.5 text-sm text-primary placeholder:text-disabled focus:border-accent focus:outline-none ${className}`}
      {...props}
    />
  );
}

/** Выпадающий список. */
export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-card border border-line bg-surface px-3 py-1.5 text-sm text-primary focus:border-accent focus:outline-none ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

/** Подпись + контрол в одну строку (для компактных форм и фильтров). */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm text-secondary">
      {label}
      {children}
    </label>
  );
}
