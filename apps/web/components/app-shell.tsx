'use client';
import type { ReactNode } from 'react';
import HomePage from './home';
import { useSession } from './session-context';
import { GameTimeWidget } from './game-time-widget';
import { NavMenu } from './nav-menu';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { SiteHeader } from './ui/layout';
import { ApplicationFrame, GuildBrand } from './ui';
import { useEffect, useState } from 'react';
import { api, API_URL_VALUE } from '../lib/api';
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const [guildName, setGuildName] = useState('Гильдия');
  const [crestUrl, setCrestUrl] = useState<string | null>(null);
  useEffect(() => {
    if (user && (user.memberId || user.isAdmin)) {
      let active = true;
      const loadGuild = () =>
        api<{ name: string; hasCrest?: boolean }>('/meta/guild')
          .then((value) => {
            if (active) {
              setGuildName(value.name);
              setCrestUrl(
                value.hasCrest ? `${API_URL_VALUE}/settings/guild/crest?v=${Date.now()}` : null,
              );
            }
          })
          .catch(() => {});
      void loadGuild();
      window.addEventListener('guild:changed', loadGuild);
      return () => {
        active = false;
        window.removeEventListener('guild:changed', loadGuild);
      };
    }
  }, [user]);
  if (loading) return <main className="p-6">Загрузка…</main>;
  if (!user || (!user.memberId && !user.isAdmin)) return <HomePage />;
  return (
    <ApplicationFrame
      navigation={<NavMenu />}
      header={
        <SiteHeader navigation={<GuildBrand name={guildName} crestUrl={crestUrl} />}>
          <GameTimeWidget />
          <ThemeToggle />
          <UserMenu />
        </SiteHeader>
      }
    >
      {children}
    </ApplicationFrame>
  );
}
