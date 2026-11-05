'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { can, type Permission } from '@dkp/shared';
import { useSession } from './session-context';

/** Пункт навигации: показывается всем либо требует права (матрица 2.6). */
const NAV_ITEMS: Array<{ href: string; label: string; permission?: Permission }> = [
  { href: '/', label: 'Главная' },
  { href: '/roster', label: 'Состав', permission: 'members.view_roster' },
  { href: '/link-requests', label: 'Заявки', permission: 'link_requests.review' },
];

/** Навигация по сайту: ссылки видимы по правам сессии. */
export function NavMenu() {
  const { user, loading } = useSession();
  const pathname = usePathname();

  if (loading || !user) {
    return null; // до входа внутренняя навигация не нужна
  }

  const items = NAV_ITEMS.filter(
    (item) =>
      !item.permission ||
      can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, item.permission),
  );

  return (
    <nav className="site-nav">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={pathname === item.href ? 'nav-link active' : 'nav-link'}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
