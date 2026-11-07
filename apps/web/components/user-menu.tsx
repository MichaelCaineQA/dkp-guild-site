'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RANK_LABELS, type DkpBalanceRow } from '@dkp/shared';
import { useSession } from './session-context';
import { api } from '../lib/api';
import { Badge, Button, ErrorText, HeaderIdentity, Modal, Stack } from './ui';
export function UserMenu() {
  const { user, loading, reload } = useSession();
  const router = useRouter();
  const [identity, setIdentity] = useState<DkpBalanceRow | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setIdentity(null);
    if (!user?.memberId) return;
    let active = true;
    const load = () =>
      api<DkpBalanceRow>(`/dkp/balances/${encodeURIComponent(user.memberId!)}`)
        .then((value) => {
          if (active) setIdentity(value);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(() => {
      void load();
    }, 60000);
    window.addEventListener('focus', load);
    window.addEventListener('dkp:changed', load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener('dkp:changed', load);
    };
  }, [user?.memberId]);
  if (loading || !user || (!user.memberId && !user.isAdmin)) return null;
  async function logout() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      await reload();
      router.replace('/');
      setConfirm(false);
    } catch {
      setError('Не удалось выйти. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <HeaderIdentity
      name={identity?.memberName ?? user.username}
      memberId={user.memberId}
      balance={identity?.balance ?? null}
    >
      <Badge tone="accent">
        {user.isAdmin ? 'Админ' : user.rank ? RANK_LABELS[user.rank] : ''}
      </Badge>
      <Button
        onClick={() => {
          setError('');
          setConfirm(true);
        }}
      >
        Выход
      </Button>
      {confirm && (
        <Modal
          title="Выйти из аккаунта?"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <Stack>
            <p>Вы вернётесь на экран приветствия.</p>
            {error && (
              <div role="alert">
                <ErrorText>{error}</ErrorText>
              </div>
            )}
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void logout();
              }}
            >
              Выйти
            </Button>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Отмена
            </Button>
          </Stack>
        </Modal>
      )}
    </HeaderIdentity>
  );
}
