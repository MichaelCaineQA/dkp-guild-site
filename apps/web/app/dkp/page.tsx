'use client';

import { useCallback, useEffect, useState } from 'react';
import { DKP_ENTRY_TYPES, type DkpBalanceRow, type DkpEntryRow } from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Muted,
  Page,
  PageHeader,
  SectionTitle,
  Select,
  Table,
} from '../../components/ui';

interface MemberRow {
  id: string;
  nickname: string;
}

const TYPE_LABELS: Record<string, string> = {
  CHECKIN_EARN: 'чек-ин',
  MANUAL_EARN: 'ручное',
  AUCTION_SPEND: 'аукцион',
  ADJUSTMENT: 'корректировка',
};

/**
 * «ДКП-журнал» (issue #12, план 2.2): публичная прозрачность — операции
 * и балансы видны всем членам гильдии (решение №4). Любая цифра баланса
 * раскрывается до цепочки операций фильтром по игроку.
 */
export default function DkpPage() {
  const { user, loading: sessionLoading } = useSession();
  const [entries, setEntries] = useState<DkpEntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [balances, setBalances] = useState<DkpBalanceRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [memberFilter, setMemberFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (memberFilter) {
        params.set('memberId', memberFilter);
      }
      if (typeFilter) {
        params.set('type', typeFilter);
      }
      const [entriesData, balancesData, membersData] = await Promise.all([
        api<{ entries: DkpEntryRow[]; total: number }>(`/dkp/entries?${params}`),
        api<DkpBalanceRow[]>('/dkp/balances'),
        api<MemberRow[]>('/members'),
      ]);
      setEntries(entriesData.entries);
      setTotal(entriesData.total);
      setBalances(balancesData);
      setMembers(membersData);
      setError(null);
    } catch {
      setError('Не удалось загрузить журнал');
    }
  }, [memberFilter, typeFilter, offset]);

  useEffect(() => {
    if (!sessionLoading && user?.memberId) {
      void load();
    }
  }, [sessionLoading, user, load]);

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return (
      <Page>
        <PageHeader title="ДКП-журнал" subtitle="Раздел доступен членам гильдии после входа." />
      </Page>
    );
  }

  if (!user.memberId && !user.isAdmin) {
    return (
      <Page>
        <PageHeader
          title="ДКП-журнал"
          subtitle="Ваш аккаунт ещё не привязан к члену гильдии — отправьте заявку на привязку ника."
        />
      </Page>
    );
  }

  const myBalance = balances.find((b) => b.memberId === user.memberId);

  return (
    <Page width="wide">
      <PageHeader
        title="ДКП-журнал"
        subtitle="Журнал append-only: балансы = сумма операций, «исправление» — новая корректировка."
      />
      {error && <ErrorText>{error}</ErrorText>}

      <Card className="mb-4">
        <SectionTitle>Балансы гильдии</SectionTitle>
        {myBalance && (
          <p className="mb-2 text-sm">
            Ваш баланс: <span className="font-semibold">{myBalance.balance}</span> ДКП
          </p>
        )}
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
          {balances.map((row) => (
            <button
              key={row.memberId}
              type="button"
              onClick={() => {
                setMemberFilter(row.memberId);
                setOffset(0);
              }}
              className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
              title="Показать операции игрока"
            >
              <span>{row.memberName}</span>
              <span className={`tabular-nums font-semibold ${row.balance < 0 ? 'text-danger' : 'text-success'}`}>
                {row.balance}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>Операции</SectionTitle>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Field label="Игрок:">
            <Select
              value={memberFilter}
              onChange={(e) => {
                setMemberFilter(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">все</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nickname}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Тип:">
            <Select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">все</option>
              {DKP_ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          {(memberFilter || typeFilter) && (
            <Button
              onClick={() => {
                setMemberFilter('');
                setTypeFilter('');
                setOffset(0);
              }}
            >
              Сбросить
            </Button>
          )}
          <Muted>
            {offset + 1}–{Math.min(offset + LIMIT, total)} из {total}
          </Muted>
          <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
            ←
          </Button>
          <Button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
            →
          </Button>
        </div>

        <Table>
          <thead>
            <tr>
              <Table.Th>Когда</Table.Th>
              <Table.Th>Кто</Table.Th>
              <Table.Th>Тип</Table.Th>
              <Table.Th>Сумма</Table.Th>
              <Table.Th>Комментарий</Table.Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.id}>
                <Table.Td className="whitespace-nowrap">
                  {new Date(row.createdAt).toLocaleString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Table.Td>
                <Table.Td className="font-medium"><a className="text-accent hover:underline" href={`/profiles/${encodeURIComponent(row.memberId)}`}>{row.memberName}</a></Table.Td>
                <Table.Td>
                  <Badge tone={row.type === 'ADJUSTMENT' ? 'warning' : 'neutral'}>
                    {TYPE_LABELS[row.type] ?? row.type}
                  </Badge>
                </Table.Td>
                <Table.Td
                  className={`tabular-nums font-semibold ${row.amount < 0 ? 'text-danger' : 'text-success'}`}
                >
                  {row.amount > 0 ? `+${row.amount}` : row.amount}
                </Table.Td>
                <Table.Td>{row.comment ?? <Muted>—</Muted>}</Table.Td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <Table.Td colSpan={5}>
                  <Muted>Операций не найдено</Muted>
                </Table.Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </Page>
  );
}
