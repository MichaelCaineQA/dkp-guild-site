'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { Avatar } from '../avatar';
export interface NavItemView {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}
function MenuIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    home: 'M3 11 12 3l9 8M5 10v11h5v-6h4v6h5V10',
    calendar: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4',
    users:
      'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-3a6 6 0 0 1 12 0v3M16 4a4 4 0 0 1 0 8M18 15a5 5 0 0 1 4 6',
    clock: 'M12 8v5l3 2M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0',
    book: 'M4 3h16v18H4zM8 7h8M8 11h8M8 15h5',
    audit: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h8',
    settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
    shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 11l3 3 5-6',
    design: 'M4 4h16v16H4zM4 12h16M12 4v16',
    auction: 'M14 4l6 6-9 9-6-6zM11 13l-8 8M3 19l2 2',
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
    >
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}
export function SidebarFrame({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  return (
    <aside
      aria-label="Боковая навигация"
      data-expanded={expanded}
      className={`peer fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface md:flex ${expanded ? 'w-56' : 'w-16'}`}
    >
      {children}
    </aside>
  );
}
export function NavigationToggle({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={expanded ? 'Свернуть меню' : 'Развернуть меню'}
      aria-expanded={expanded}
      onClick={onClick}
      className="m-3 flex h-10 items-center justify-center rounded-lg hover:bg-surface-muted"
    >
      <MenuIcon name="menu" />
    </button>
  );
}
export function NavigationLinks({
  items,
  collapsed,
  onNavigate,
}: {
  items: NavItemView[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Разделы сайта" className="min-h-0 space-y-1 overflow-y-auto px-2 pb-4">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          title={item.label}
          aria-label={item.label}
          aria-current={item.active ? 'page' : undefined}
          onClick={onNavigate}
          className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm ${item.active ? 'bg-accent-soft font-semibold text-accent' : 'text-secondary hover:bg-surface-muted hover:text-primary'}`}
        >
          <MenuIcon name={item.icon} />
          <span className={collapsed ? 'sr-only' : 'min-w-0 break-words'}>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Открыть меню"
      onClick={onClick}
      className="fixed left-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface hover:bg-surface-muted md:hidden"
    >
      <MenuIcon name="menu" />
    </button>
  );
}
export function MobileNavigation({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => {
      node?.close?.();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Меню разделов"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-72 max-w-[90vw] border-r border-line bg-surface p-0 text-primary backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between p-4">
        <strong>Меню</strong>
        <button
          type="button"
          aria-label="Закрыть меню"
          onClick={onClose}
          className="rounded-lg px-3 py-2 hover:bg-surface-muted"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ApplicationFrame({
  navigation,
  header,
  children,
}: {
  navigation: ReactNode;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {navigation}
      <div className="min-h-dvh min-w-0 md:ml-16 md:peer-data-[expanded=true]:ml-56">
        {header}
        {children}
      </div>
    </>
  );
}
export function GuildBrand({ name, crestUrl }: { name: string; crestUrl?: string | null }) {
  return (
    <Link href="/" title={name} className="flex min-w-0 items-center gap-3 font-semibold">
      {crestUrl ? (
        <img src={crestUrl} alt="" className="h-9 w-9 shrink-0 object-contain" />
      ) : (
        <MenuIcon name="shield" />
      )}
      <span className="max-w-48 truncate">{name}</span>
    </Link>
  );
}
export function HeaderIdentity({
  name,
  memberId,
  balance,
  avatar,
  avatarColor,
  children,
}: {
  name: string;
  memberId: string | null;
  balance: number | null;
  avatar?: string | null;
  avatarColor?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <span aria-label="Баланс ДКП" className="whitespace-nowrap tabular-nums">
        {balance ?? '—'} ДКП
      </span>
      {memberId ? (
        <Link
          aria-label="Мой профиль"
          title={name}
          href={`/profiles/${encodeURIComponent(memberId)}`}
          className="flex min-w-0 items-center gap-2 text-accent hover:underline"
        >
          <Avatar avatar={avatar} avatarColor={avatarColor} nickname={name} />
          <span className="max-w-28 truncate">{name}</span>
        </Link>
      ) : (
        <span>{name}</span>
      )}
      {children}
    </div>
  );
}
export function PhaseIndicator({
  phase,
  timer,
  details,
  open,
  onToggle,
}: {
  phase: 'DAY' | 'NIGHT';
  timer: string;
  details: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label="Игровое время"
        aria-expanded={open}
        title={details}
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-muted px-2.5 py-1 text-xs"
      >
        {phase === 'DAY' ? '☀' : '☾'}
        <span className="tabular-nums">
          {phase === 'DAY' ? 'день' : 'ночь'} · {timer}
        </span>
      </button>
      {open && (
        <span
          role="status"
          className="absolute left-0 top-full z-40 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-3 text-xs shadow-lg"
        >
          {details}
        </span>
      )}
    </span>
  );
}
