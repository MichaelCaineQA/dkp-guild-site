'use client';
import type { ReactNode } from 'react';
import HomePage from './home';
import { useSession } from './session-context';
import { GameTimeWidget } from './game-time-widget';
import { NavMenu } from './nav-menu';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { SiteHeader } from './ui/layout';
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading) return <main className="p-6">Загрузка…</main>;
  if (!user || (!user.memberId && !user.isAdmin)) return <HomePage />;
  return (
    <>
      <SiteHeader navigation={<NavMenu />}>
        <GameTimeWidget />
        <ThemeToggle />
        <UserMenu />
      </SiteHeader>
      {children}
    </>
  );
}
