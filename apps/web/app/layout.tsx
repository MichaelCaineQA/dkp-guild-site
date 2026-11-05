import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NavMenu } from '../components/nav-menu';
import { SessionProvider } from '../components/session-context';
import { UserMenu } from '../components/user-menu';
import './globals.css';

export const metadata: Metadata = {
  title: 'ДКП-система гильдии',
  description: 'Расписание ивентов, ДКП, аукцион лута и статистика гильдии',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <SessionProvider>
          <header className="site-header">
            <span className="site-title">
              <NavMenu />
            </span>
            <UserMenu />
          </header>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
