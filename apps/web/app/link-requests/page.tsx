'use client';

import { useCallback, useEffect, useState } from 'react';
import { can } from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';

interface LinkRequest {
  id: string;
  nickname: string;
  createdAt: string;
  user: { username: string };
}

/** Очередь заявок «Discord ↔ ник» для офицеров (issue #6, план 2.9). */
export default function LinkRequestsPage() {
  const { user, loading: sessionLoading } = useSession();
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await api<LinkRequest[]>('/auth/link-requests'));
      setError(null);
    } catch {
      setError('Не удалось загрузить заявки');
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && user?.memberId) {
      void load();
    }
  }, [sessionLoading, user, load]);

  const canReview =
    user && can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'link_requests.review');

  const resolve = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      await api(`/auth/link-requests/${id}/${action}`, { method: 'POST' });
      await load();
    } catch {
      setError('Не удалось обработать заявку');
    } finally {
      setBusyId(null);
    }
  };

  if (sessionLoading) {
    return <main style={{ padding: 24 }}>Загрузка…</main>;
  }

  if (!canReview) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Заявки на привязку</h1>
        <p>Раздел доступен офицерам и выше.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Заявки на привязку</h1>
      <p>Игрок вошёл через Discord и просит связать аккаунт с ником члена гильдии.</p>
      {error && <p className="error">{error}</p>}
      <table className="roster-table">
        <thead>
          <tr>
            <th>Discord</th>
            <th>Игровой ник</th>
            <th>Подана</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td>{request.user.username}</td>
              <td>{request.nickname}</td>
              <td>{new Date(request.createdAt).toLocaleString('ru-RU')}</td>
              <td>
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => resolve(request.id, 'approve')}
                >
                  Подтвердить
                </button>{' '}
                <button
                  type="button"
                  disabled={busyId === request.id}
                  onClick={() => resolve(request.id, 'reject')}
                >
                  Отклонить
                </button>
              </td>
            </tr>
          ))}
          {requests.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                Новых заявок нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
