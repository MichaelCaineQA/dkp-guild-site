'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SessionUser } from '@dkp/shared';

interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  user: null,
  loading: true,
  reload: async () => {},
});

/** Сессия для всего приложения: один /auth/me, право берём из сессии. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { api } = await import('../lib/api');
    api<{ user: SessionUser | null }>('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, reload: load }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
