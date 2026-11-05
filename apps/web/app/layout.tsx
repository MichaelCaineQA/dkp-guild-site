import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
        <header className="site-header">
          <span className="site-title">ДКП-система гильдии</span>
          <UserMenu />
        </header>
        {children}
      </body>
    </html>
  );
}
