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
    primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
    secondary: 'border border-line bg-surface text-primary hover:bg-surface-muted',
    danger: 'bg-danger text-white hover:opacity-90',
  };
  return (
    <button
      className={`${TOUCH_TARGET} rounded-lg px-4 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

/** Поле ввода текста. */
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`${TOUCH_TARGET} min-w-0 max-w-full rounded-lg border border-line bg-surface px-3 py-1.5 ${FIELD_TEXT} text-primary placeholder:text-disabled focus:border-accent focus:outline-none ${className}`}
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
      className={`${TOUCH_TARGET} min-w-0 max-w-full rounded-lg border border-line bg-surface px-3 py-1.5 ${FIELD_TEXT} text-primary focus:border-accent focus:outline-none ${className}`}
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
/** Ссылки-вкладки: на телефоне цель касания не меньше 44px по высоте. */
const TAB_TARGET = 'inline-flex min-h-11 items-center md:min-h-0';
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
    <nav aria-label="Вкладки состава" className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
      <TextLink
        href="/roster"
        aria-current={current === 'members' ? 'page' : undefined}
        className={TAB_TARGET}
      >
        Участники
      </TextLink>
      <TextLink
        href="/roster/kp"
        aria-current={current === 'kp' ? 'page' : undefined}
        className={TAB_TARGET}
      >
        КП
      </TextLink>
      <TextLink
        href="/roster/pack"
        aria-current={current === 'pack' ? 'page' : undefined}
        className={TAB_TARGET}
      >
        Пак
      </TextLink>
      {requests && (
        <TextLink
          href="/link-requests"
          aria-current={current === 'requests' ? 'page' : undefined}
          className={TAB_TARGET}
        >
          Заявки
        </TextLink>
      )}
      {blocked && (
        <TextLink
          href="/roster/blocked"
          aria-current={current === 'blocked' ? 'page' : undefined}
          className={TAB_TARGET}
        >
          Заблокированные
        </TextLink>
      )}
    </nav>
  );
}
