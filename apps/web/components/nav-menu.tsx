'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { can, type Permission } from '@dkp/shared';
import { useSession } from './session-context';
import {
  MobileMenuButton,
  MobileNavigation,
  NavigationLinks,
  NavigationToggle,
  SidebarFrame,
} from './ui';
const NAV_ITEMS: Array<{ href: string; label: string; icon: string; permission: Permission }> = [
  { href: '/', label: 'Дашборд', icon: 'home', permission: 'members.view_roster' },
  { href: '/schedule', label: 'Расписание', icon: 'calendar', permission: 'members.view_roster' },
  { href: '/roster', label: 'Состав гильдии', icon: 'users', permission: 'members.view_roster' },
  { href: '/absences', label: 'Отсутствия', icon: 'clock', permission: 'members.view_roster' },
  { href: '/dkp', label: 'Журнал ДКП', icon: 'book', permission: 'members.view_roster' },
  {
    href: '/rules/guild-rules',
    label: 'Правила гильдии',
    icon: 'shield',
    permission: 'members.view_roster',
  },
  {
    href: '/rules/site-rules',
    label: 'Правила сайта',
    icon: 'book',
    permission: 'members.view_roster',
  },
  { href: '/audit', label: 'Лог действий', icon: 'audit', permission: 'audit.view' },
  { href: '/settings', label: 'Настройки', icon: 'settings', permission: 'settings.manage' },
  { href: '/design', label: 'Витрина дизайна', icon: 'design', permission: 'settings.manage' },
];
export function NavMenu() {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem('dkp.navigation.expanded') === 'true');
    } catch {}
  }, []);
  if (loading || !user || !can(user, 'members.view_roster')) return null;
  const items = NAV_ITEMS.filter((item) => can(user, item.permission)).map((item) => ({
    ...item,
    active:
      pathname === item.href ||
      (item.href === '/roster' &&
        (pathname === '/link-requests' || pathname.startsWith('/applications/'))),
  }));
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem('dkp.navigation.expanded', String(next));
    } catch {}
  };
  return (
    <>
      <SidebarFrame expanded={expanded}>
        <NavigationToggle expanded={expanded} onClick={toggle} />
        <NavigationLinks items={items} collapsed={!expanded} />
      </SidebarFrame>
      <MobileMenuButton onClick={() => setMobile(true)} />
      {mobile && (
        <MobileNavigation onClose={() => setMobile(false)}>
          <NavigationLinks items={items} collapsed={false} onNavigate={() => setMobile(false)} />
        </MobileNavigation>
      )}
    </>
  );
}
