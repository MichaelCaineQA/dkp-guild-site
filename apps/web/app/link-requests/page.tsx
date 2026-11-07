'use client';

import { useCallback, useEffect, useState } from 'react';
import { can, COMBAT_ROLE_LABELS, formatWeapons, type CombatRole, type Weapon } from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import {
  Button,
  Card,
  ErrorText,
  Muted,
  Notice,
  Page,
  PageHeader,
  Table,
} from '../../components/ui';

interface LinkRequest {
  combatRole: CombatRole | null;
  weapons: Weapon[];
  id: string;
  nickname: string;
  createdAt: string;
  user: { username: string };
}

/** Очередь заявок «Discord ↔ ник» для Главы/Админа (issue #6, план 2.9). */
export default function LinkRequestsPage() {
  const { user, loading: sessionLoading } = useSession();
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canReview = !!user && can(user, 'link_requests.review');

  const load = useCallback(async () => {
    try {
      setRequests(await api<LinkRequest[]>('/auth/link-requests'));
      setError(null);
    } catch {
      setError('Не удалось загрузить заявки');
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && canReview) {
      void load();
    }
  }, [sessionLoading, canReview, load]);

  const resolve = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    try {
      await api(`/auth/link-requests/${id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(
        (err as { status?: number }).status === 409
          ? 'В старой заявке нет роли или оружия. Отклоните её — игрок сможет подать новую.'
          : 'Не удалось обработать заявку',
      );
    } finally {
      setBusyId(null);
    }
  };

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!canReview) {
    return (
      <Page>
        <PageHeader title="Заявки на привязку" />
        <Notice>Раздел доступен Главе и Админу.</Notice>
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Заявки на привязку"
        subtitle="Игрок вошёл через Discord и просит связать аккаунт с ником члена гильдии"
      />
      {error && <ErrorText>{error}</ErrorText>}
      <Card className="p-0">
        <Table className="p-5">
          <thead>
            <tr>
              <Table.Th>Discord</Table.Th>
              <Table.Th>Игровой ник</Table.Th>
              <Table.Th>Роль</Table.Th>
              <Table.Th>Класс (оружия)</Table.Th>
              <Table.Th>Подана</Table.Th>
              <Table.Th>Действия</Table.Th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <Table.Td>{request.user.username}</Table.Td>
                <Table.Td className="font-medium">{request.nickname}</Table.Td>
                <Table.Td>
                  {request.combatRole ? COMBAT_ROLE_LABELS[request.combatRole] : 'Не указана'}
                </Table.Td>
                <Table.Td>{formatWeapons(request.weapons ?? [])}</Table.Td>
                <Table.Td>{new Date(request.createdAt).toLocaleString('ru-RU')}</Table.Td>
                <Table.Td>
                  <span className="flex gap-2">
                    <Button
                      disabled={busyId === request.id}
                      onClick={() => resolve(request.id, 'approve')}
                    >
                      Подтвердить
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busyId === request.id}
                      onClick={() => resolve(request.id, 'reject')}
                    >
                      Отклонить
                    </Button>
                  </span>
                </Table.Td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <Table.Td colSpan={6}>
                  <Muted>Новых заявок нет</Muted>
                </Table.Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </Page>
  );
}
