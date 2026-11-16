'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COMBAT_ROLE_LABELS,
  RANK_LABELS,
  can,
  formatWeapons,
  type CombatRole,
  type Rank,
  type Weapon,
} from '@dkp/shared';
import { useSession } from '../../../components/session-context';
import { api } from '../../../lib/api';
import {
  Button,
  Card,
  ErrorText,
  Input,
  Muted,
  Notice,
  Page,
  PageHeader,
  RosterTabs,
  Table,
} from '../../../components/ui';
import { Avatar } from '../../../components/avatar';

interface BlockedRow {
  avatar?: string | null;
  avatarColor?: string | null;
  weapons: Weapon[];
  id: string;
  nickname: string;
  rank: Rank;
  combatRole: CombatRole | null;
  discord: string | null;
  blockedAt: string;
}

/** Вкладка «Заблокированные» состава (issue #149) — Глава/Админ. */
export default function BlockedMembersPage() {
  const { user, loading: sessionLoading } = useSession();
  const [rows, setRows] = useState<BlockedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BlockedRow | null>(null);

  const canManage = useMemo(
    () =>
      !!user &&
      can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'members.manage'),
    [user],
  );

  const loadBlocked = useCallback(async () => {
    try {
      setRows(await api<BlockedRow[]>('/members/blocked'));
      setError(null);
    } catch {
      setError('Не удалось загрузить заблокированных');
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && canManage) {
      void loadBlocked();
    }
  }, [sessionLoading, canManage, loadBlocked]);

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user || (!user.memberId && !user.isAdmin)) {
    return (
      <Page>
        <PageHeader title="Заблокированные" />
        <Notice>Раздел доступен членам гильдии после входа.</Notice>
      </Page>
    );
  }

  if (!canManage) {
    return (
      <Page>
        <PageHeader title="Заблокированные" />
        <Notice>Раздел доступен только Главе и Админу.</Notice>
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Заблокированные"
        subtitle="Покинувшие гильдию: данные сохранены, вход закрыт. Разблокировка возвращает доступ."
      />

      <RosterTabs
        requests={!!user && can(user, 'link_requests.review')}
        blocked
        current="blocked"
      />
      {error && <ErrorText>{error}</ErrorText>}

      <Card className="p-0">
        <Table className="p-5">
          <thead>
            <tr>
              <Table.Th>Ник</Table.Th>
              <Table.Th>Ранг</Table.Th>
              <Table.Th>Роль</Table.Th>
              <Table.Th>Класс (оружия)</Table.Th>
              <Table.Th>Discord</Table.Th>
              <Table.Th>Заблокирован</Table.Th>
              <Table.Th> </Table.Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Table.Row key={row.id}>
                <Table.Td className="font-medium">
                  <Avatar
                    avatar={row.avatar}
                    avatarColor={row.avatarColor}
                    nickname={row.nickname}
                  />
                  {row.nickname}
                </Table.Td>
                <Table.Td>{RANK_LABELS[row.rank]}</Table.Td>
                <Table.Td>
                  {row.combatRole ? COMBAT_ROLE_LABELS[row.combatRole] : <Muted>—</Muted>}
                </Table.Td>
                <Table.Td>{formatWeapons(row.weapons ?? [])}</Table.Td>
                <Table.Td>{row.discord ?? <Muted>—</Muted>}</Table.Td>
                <Table.Td>{new Date(row.blockedAt).toLocaleString('ru-RU')}</Table.Td>
                <Table.Td>
                  <Button onClick={() => setSelected(row)}>Разблокировать</Button>
                </Table.Td>
              </Table.Row>
            ))}
            {rows.length === 0 && (
              <tr>
                <Table.Td colSpan={7}>
                  <Muted>Заблокированных нет</Muted>
                </Table.Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      {selected && (
        <UnblockCard
          row={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            void loadBlocked();
          }}
        />
      )}
    </Page>
  );
}

/** Подтверждение разблокировки: комментарий обязателен (аудит). */
function UnblockCard({
  row,
  onClose,
  onDone,
}: {
  row: BlockedRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unblock = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/members/${row.id}/unblock`, {
        method: 'POST',
        body: JSON.stringify({ comment: comment.trim() }),
      });
      onDone();
    } catch {
      setMessage('Не удалось разблокировать. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4">
      <h2 className="text-xl font-semibold text-primary">Разблокировать {row.nickname}?</h2>
      <p className="mt-1 text-sm text-secondary">
        Участник вернётся в состав с прежним рангом и всей историей (ДКП, класс, лут).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Комментарий (обязателен, попадёт в аудит)"
          minLength={3}
          maxLength={500}
          className="w-80"
        />
        <Button variant="primary" onClick={unblock} disabled={busy || comment.trim().length < 3}>
          Разблокировать
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Отмена
        </Button>
      </div>
      {message && <p className="mt-3 text-sm text-primary">{message}</p>}
    </Card>
  );
}
