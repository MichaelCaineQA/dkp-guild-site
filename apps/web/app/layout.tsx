import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { GameTimeWidget } from '../components/game-time-widget';
import { NavMenu } from '../components/nav-menu';
import { SessionProvider } from '../components/session-context';
import { ThemeToggle } from '../components/theme-toggle';
import { UserMenu } from '../components/user-menu';
import './globals.css';

export const metadata: Metadata = {
  title: 'ДКП-система гильдии',
  description: 'Расписание ивентов, ДКП, аукцион лута и статистика гильдии',
};

// Применяем сохранённую тему до первой отрисовки — без мигания светлым
const themeInit = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.add(d?'dark':'light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <SessionProvider>
          <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 sm:px-6">
            <NavMenu />
            <span className="flex items-center gap-3">
              <GameTimeWidget />
              <ThemeToggle />
              <UserMenu />
            </span>
          </header>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
