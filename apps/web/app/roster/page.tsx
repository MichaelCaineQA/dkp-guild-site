'use client';
import { GearScoreStale } from '../../components/ui/gear-score-stale';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COMBAT_ROLES,
  COMBAT_ROLE_LABELS,
  RANKS,
  RANK_LABELS,
  can,
  WEAPONS,
  WEAPON_LABELS,
  formatWeapons,
  type Weapon,
  type CombatRole,
  type Rank,
} from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import { createRequestId } from '../../lib/request-id';
import {
  Badge,
  RosterTabs,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Muted,
  Notice,
  Page,
  PageHeader,
  Select,
  Table,
} from '../../components/ui';

import { Avatar } from '../../components/avatar';
import { TransferMemberModal } from '../../components/roster-groups';
interface RosterRow {
  avatar?: string | null;
  avatarColor?: string | null;
  weapons: Weapon[];
  id: string;
  nickname: string;
  rank: Rank;
  combatRole: CombatRole | null;
  discord: string | null;
}
type OrgGroup = {
  id: string;
  name: string;
  leaderId: string | null;
  packs: { id: string; name: string; kpId: string; leaderId: string | null }[];
};
type OrgMember = {
  id: string;
  gearScore?: number | null;
  gearScoreStale?: boolean;
  pack: { id: string; name: string; kp: { id: string; name: string } } | null;
};

/** «Состав гильдии» (issue #6): таблица с фильтрами, доступна всем членам. */
export default function RosterPage() {
  const { user, loading: sessionLoading } = useSession();
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [groups, setGroups] = useState<OrgGroup[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [kpFilter, setKpFilter] = useState('');
  const [packFilter, setPackFilter] = useState('');
  const [transfer, setTransfer] = useState<RosterRow | null>(null);
  const [rankFilter, setRankFilter] = useState<Rank | ''>('');
  const [roleFilter, setRoleFilter] = useState<CombatRole | ''>('');
  const [weaponFilter, setWeaponFilter] = useState<Weapon | ''>('');
  const [availableNow, setAvailableNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RosterRow | null>(null);
  // Сортировка столбцов + пагинация (ревью владельца, п.9)
  const [sortKey, setSortKey] = useState<keyof RosterRow | 'kp' | 'pack' | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [pageOffset, setPageOffset] = useState(0);
  const PAGE_SIZE = 20;

  const RANK_ORDER_UI: Record<string, number> = {
    GUILD_LEADER: 3,
    ADMIN: 2,
    OFFICER: 1,
    MEMBER: 0,
  };

  const sortedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const member = orgMembers.find((item) => item.id === row.id);
      return (
        (!kpFilter || member?.pack?.kp.id === kpFilter) &&
        (!packFilter || member?.pack?.id === packFilter)
      );
    });
    if (!sortKey) {
      return filtered;
    }
    return [...filtered].sort((a, b) => {
      const av =
        sortKey === 'kp'
          ? (orgMembers.find((item) => item.id === a.id)?.pack?.kp.name ?? '')
          : sortKey === 'pack'
            ? (orgMembers.find((item) => item.id === a.id)?.pack?.name ?? '')
            : sortKey === 'weapons'
              ? formatWeapons(a.weapons ?? [])
              : sortKey === 'rank'
                ? (RANK_ORDER_UI[a.rank] ?? 0)
                : (a[sortKey] ?? '');
      const bv =
        sortKey === 'kp'
          ? (orgMembers.find((item) => item.id === b.id)?.pack?.kp.name ?? '')
          : sortKey === 'pack'
            ? (orgMembers.find((item) => item.id === b.id)?.pack?.name ?? '')
            : sortKey === 'weapons'
              ? formatWeapons(b.weapons ?? [])
              : sortKey === 'rank'
                ? (RANK_ORDER_UI[b.rank] ?? 0)
                : (b[sortKey] ?? '');
      const cmp = String(av).localeCompare(String(bv), 'ru');
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortKey, sortAsc, orgMembers, kpFilter, packFilter]);

  function toggleSort(key: keyof RosterRow | 'kp' | 'pack') {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
    setPageOffset(0);
  }

  function sortIndicator(key: keyof RosterRow | 'kp' | 'pack') {
    if (sortKey !== key) {
      return '↕';
    }
    return sortAsc ? '↑' : '↓';
  }

  const loadRoster = useCallback(async () => {
    const params = new URLSearchParams();
    if (weaponFilter) params.set('weapon', weaponFilter);
    if (availableNow) params.set('availableNow', 'true');
    if (rankFilter) {
      params.set('rank', rankFilter);
    }
    if (roleFilter) {
      params.set('combatRole', roleFilter);
    }
    try {
      setRows(await api<RosterRow[]>(`/members?${params.toString()}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error && 'status' in err ? 'Не удалось загрузить состав' : 'Ошибка');
    }
  }, [rankFilter, roleFilter, weaponFilter, availableNow]);

  useEffect(() => {
    if (!sessionLoading && (user?.memberId || user?.isAdmin)) {
      void loadRoster();
    }
  }, [sessionLoading, user, loadRoster]);

  useEffect(() => {
    if (sessionLoading || (!user?.memberId && !user?.isAdmin)) return;
    let active = true;
    void api<{ groups: OrgGroup[]; members: OrgMember[] }>('/org/roster')
      .then((data) => {
        if (active && Array.isArray(data.groups) && Array.isArray(data.members)) {
          setGroups(data.groups);
          setOrgMembers(data.members);
        }
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить КП и паки');
      });
    return () => {
      active = false;
    };
  }, [sessionLoading, user]);

  const canManage = useMemo(
    () =>
      user &&
      can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'members.manage'),
    [user],
  );

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return (
      <Page>
        <PageHeader title="Состав гильдии" />
        <Notice>Раздел доступен членам гильдии после входа.</Notice>
      </Page>
    );
  }

  if (!user.memberId && !user.isAdmin) {
    return (
      <Page>
        <PageHeader title="Состав гильдии" />
        <Notice>
          Ваш аккаунт ещё не привязан к члену гильдии. Отправьте{' '}
          <a className="text-accent hover:underline" href="/link">
            заявку на привязку ника
          </a>
          .
        </Notice>
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Состав гильдии"
        subtitle="Все члены гильдии: ранги, роли в бою, привязка Discord"
      />

      <RosterTabs
        requests={!!user && can(user, 'link_requests.review')}
        blocked={!!canManage}
        current="members"
      />
      <details open className="mb-4">
        <summary>Фильтры · Всего: {sortedRows.length}</summary>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Field label="КП:">
            <Select
              value={kpFilter}
              onChange={(e) => {
                setKpFilter(e.target.value);
                setPackFilter('');
                setPageOffset(0);
              }}
            >
              <option value="">все КП</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Пак:">
            <Select
              value={packFilter}
              onChange={(e) => {
                setPackFilter(e.target.value);
                setPageOffset(0);
              }}
            >
              <option value="">все паки</option>
              {groups
                .filter((group) => !kpFilter || group.id === kpFilter)
                .flatMap((group) => group.packs)
                .map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Ранг:">
            <Select
              value={rankFilter}
              onChange={(e) => {
                setRankFilter(e.target.value as Rank | '');
                setPageOffset(0);
              }}
            >
              <option value="">все ранги</option>
              {RANKS.map((rank) => (
                <option key={rank} value={rank}>
                  {RANK_LABELS[rank]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Роль:">
            <Select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value as CombatRole | '');
                setPageOffset(0);
              }}
            >
              <option value="">все роли</option>
              {COMBAT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {COMBAT_ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Оружие:">
            <Select
              value={weaponFilter}
              onChange={(event) => {
                setWeaponFilter(event.target.value as Weapon | '');
                setPageOffset(0);
              }}
            >
              <option value="">все оружия</option>
              {WEAPONS.map((weapon) => (
                <option key={weapon} value={weapon}>
                  {WEAPON_LABELS[weapon]}
                </option>
              ))}
            </Select>
          </Field>
          <label>
            <input
              type="checkbox"
              checked={availableNow}
              onChange={(event) => {
                setAvailableNow(event.target.checked);
                setPageOffset(0);
              }}
            />{' '}
            Свободен сейчас
          </label>
          <Muted>Всего: {sortedRows.length}</Muted>
        </div>
      </details>

      {error && <ErrorText>{error}</ErrorText>}

      <Card className="p-0">
        <Table className="p-5">
          <thead>
            <tr>
              <Table.Th
                className="cursor-pointer select-none"
                onClick={() => toggleSort('nickname')}
              >
                Ник {sortIndicator('nickname')}
              </Table.Th>
              <Table.Th className="cursor-pointer select-none" onClick={() => toggleSort('rank')}>
                Ранг {sortIndicator('rank')}
              </Table.Th>
              <Table.Th
                className="cursor-pointer select-none"
                onClick={() => toggleSort('combatRole')}
              >
                Роль {sortIndicator('combatRole')}
              </Table.Th>
              <Table.Th
                className="cursor-pointer select-none"
                onClick={() => toggleSort('weapons')}
              >
                Класс (оружия) {sortIndicator('weapons')}
              </Table.Th>
              <Table.Th
                className="cursor-pointer select-none"
                onClick={() => toggleSort('discord')}
              >
                Discord {sortIndicator('discord')}
              </Table.Th>
              <Table.Th className="cursor-pointer select-none" onClick={() => toggleSort('kp')}>
                КП {sortIndicator('kp')}
              </Table.Th>
              <Table.Th className="cursor-pointer select-none" onClick={() => toggleSort('pack')}>
                Пак {sortIndicator('pack')}
              </Table.Th>
              {(user.isAdmin || user.rank === 'GUILD_LEADER' || user.rank === 'ADMIN') && (
                <Table.Th>GS</Table.Th>
              )}
              {canManage && <Table.Th>Действия</Table.Th>}
            </tr>
          </thead>
          <tbody>
            {sortedRows.slice(pageOffset, pageOffset + PAGE_SIZE).map((row) => (
              <Table.Row key={row.id} onClick={() => setSelected(row)}>
                <Table.Td className="font-medium">
                  <Avatar
                    avatar={row.avatar}
                    avatarColor={row.avatarColor}
                    nickname={row.nickname}
                  />
                  <a
                    className="text-accent hover:underline"
                    href={`/profiles/${encodeURIComponent(row.id)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.nickname}
                    <GearScoreStale
                      stale={orgMembers.find((item) => item.id === row.id)?.gearScoreStale}
                    />
                  </a>
                </Table.Td>
                <Table.Td>{RANK_LABELS[row.rank]}</Table.Td>
                <Table.Td>
                  {row.combatRole ? (
                    <Badge tone="accent">{COMBAT_ROLE_LABELS[row.combatRole]}</Badge>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </Table.Td>
                <Table.Td>{formatWeapons(row.weapons ?? [])}</Table.Td>
                <Table.Td>{row.discord ?? <Muted>—</Muted>}</Table.Td>
                <Table.Td>
                  {orgMembers.find((item) => item.id === row.id)?.pack?.kp.name ?? '—'}
                </Table.Td>
                <Table.Td>
                  {orgMembers.find((item) => item.id === row.id)?.pack?.name ?? '—'}
                </Table.Td>
                {(user.isAdmin || user.rank === 'GUILD_LEADER' || user.rank === 'ADMIN') && (
                  <Table.Td>
                    {orgMembers.find((item) => item.id === row.id)?.gearScore ?? '—'}
                  </Table.Td>
                )}
                {canManage && (
                  <Table.Td>
                    <Button
                      onClick={(event) => {
                        event.stopPropagation();
                        setTransfer(row);
                      }}
                    >
                      Переместить
                    </Button>
                  </Table.Td>
                )}
              </Table.Row>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <Table.Td colSpan={5}>
                  <Muted>Никого не найдено</Muted>
                </Table.Td>
              </tr>
            )}
          </tbody>
        </Table>
        {sortedRows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line p-3 text-sm">
            <Muted>
              {pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, sortedRows.length)} из{' '}
              {sortedRows.length}
            </Muted>
            <span className="flex gap-2">
              <Button
                disabled={pageOffset === 0}
                onClick={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}
              >
                ←
              </Button>
              <Button
                disabled={pageOffset + PAGE_SIZE >= sortedRows.length}
                onClick={() => setPageOffset(pageOffset + PAGE_SIZE)}
              >
                →
              </Button>
            </span>
          </div>
        )}
      </Card>

      {transfer && (
        <TransferMemberModal
          memberId={transfer.id}
          memberName={transfer.nickname}
          groups={groups}
          currentPackId={orgMembers.find((item) => item.id === transfer.id)?.pack?.id}
          onClose={() => setTransfer(null)}
          onTransferred={() => {
            setTransfer(null);
            void api<{ groups: OrgGroup[]; members: OrgMember[] }>('/org/roster').then((data) => {
              setGroups(data.groups);
              setOrgMembers(data.members);
            });
          }}
        />
      )}

      {selected && (
        <MemberCard
          row={selected}
          canAssignLeader={!!user?.isAdmin}
          canBlock={!!canManage && (selected.rank === 'MEMBER' || selected.rank === 'OFFICER')}
          canChangeRank={
            !!user &&
            can(
              { rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId },
              'members.change_rank',
            )
          }
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            void loadRoster();
          }}
        />
      )}
    </Page>
  );
}

/** Карточка члена: начисление ДКП, смена ранга и блокировка (Глава/Админ). */
function MemberCard({
  row,
  canAssignLeader,
  canBlock,
  canChangeRank,
  onClose,
  onChanged,
}: {
  row: RosterRow;
  canAssignLeader: boolean;
  canBlock: boolean;
  canChangeRank: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newRank, setNewRank] = useState<Rank>(row.rank);
  const [comment, setComment] = useState('');
  const [blockComment, setBlockComment] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantAmount, setGrantAmount] = useState('');
  const [grantComment, setGrantComment] = useState('');
  const [grantAttempt, setGrantAttempt] = useState<{
    requestId: string;
    memberId: string;
    amount: number;
    comment: string;
  } | null>(null);
  const grantStorageKey = `dkp-grant:${row.id}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(grantStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        requestId: string;
        memberId: string;
        amount: number;
        comment: string;
      };
      if (
        parsed.memberId === row.id &&
        parsed.requestId &&
        Number.isInteger(parsed.amount) &&
        typeof parsed.comment === 'string'
      ) {
        setGrantAttempt(parsed);
        setGrantAmount(String(parsed.amount));
        setGrantComment(parsed.comment);
      }
    } catch {
      /* недоступное хранилище не мешает ручному повтору */
    }
  }, [grantStorageKey, row.id]);

  const grant = async () => {
    if (busy) return;
    const input = grantAttempt ?? {
      requestId: createRequestId(),
      memberId: row.id,
      amount: Number(grantAmount),
      comment: grantComment.trim(),
    };
    setGrantAttempt(input);
    try {
      sessionStorage.setItem(grantStorageKey, JSON.stringify(input));
    } catch {
      /* повторы защищены, пока открыта форма */
    }
    setBusy(true);
    setMessage(null);
    try {
      await api('/dkp/admin-grants', { method: 'POST', body: JSON.stringify(input) });
      setGrantAttempt(null);
      try {
        sessionStorage.removeItem(grantStorageKey);
      } catch {
        /* хранилище недоступно */
      }
      onChanged();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (
        !grantAttempt &&
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 429
      ) {
        setGrantAttempt(null);
        try {
          sessionStorage.removeItem(grantStorageKey);
        } catch {
          /* хранилище недоступно */
        }
      }
      setMessage(
        status && status >= 400 && status < 500
          ? 'Начисление отклонено. Проверьте данные.'
          : 'Результат неизвестен. Повторите запрос с теми же данными.',
      );
    } finally {
      setBusy(false);
    }
  };

  const changeRank = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/members/${row.id}/change-rank`, {
        method: 'POST',
        body: JSON.stringify({ rank: newRank, comment }),
      });
      setMessage('Ранг изменён');
      onChanged();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setMessage(
        status === 409
          ? 'Такой ранг уже стоит или это последний Глава'
          : 'Не удалось изменить ранг',
      );
    } finally {
      setBusy(false);
    }
  };

  /** Блокировка покинувшего гильдию (issue #149): активные ставки снимаются. */
  const block = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/members/${row.id}/block`, {
        method: 'POST',
        body: JSON.stringify({ comment: blockComment.trim() }),
      });
      setMessage('Участник заблокирован');
      onChanged();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setMessage(
        status === 409 ? 'Уже заблокирован или блокировать нельзя' : 'Не удалось заблокировать',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4">
      <h2 className="text-xl font-semibold text-primary">{row.nickname}</h2>
      <p className="mt-1 text-sm text-secondary">
        Ранг: {RANK_LABELS[row.rank]} · Роль:{' '}
        {row.combatRole ? COMBAT_ROLE_LABELS[row.combatRole] : '—'}
      </p>
      <p>Класс: {formatWeapons(row.weapons ?? [])}</p>

      {canBlock && (
        <div className="mt-4">
          <h3 className="mb-2 font-semibold text-primary">Блокировка</h3>
          <p className="mb-2 text-sm text-secondary">
            Для покинувших гильдию: вход закроется экраном «врата», активные ставки снимутся, ДКП и
            история сохранятся. Разблокировка — на вкладке «Заблокированные».
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={blockComment}
              onChange={(e) => setBlockComment(e.target.value)}
              placeholder="Причина блокировки (обязательна, попадёт в аудит)"
              minLength={3}
              maxLength={500}
              className="w-80"
            />
            <Button
              variant="danger"
              onClick={block}
              disabled={busy || blockComment.trim().length < 3}
            >
              Заблокировать
            </Button>
          </div>
        </div>
      )}

      {canChangeRank && (
        <div className="mt-4">
          <h3 className="mb-2 font-semibold text-primary">Смена ранга</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={newRank} onChange={(e) => setNewRank(e.target.value as Rank)}>
              {RANKS.filter(
                (rank) => rank !== 'ADMIN' && (rank !== 'GUILD_LEADER' || canAssignLeader),
              ).map((rank) => (
                <option key={rank} value={rank}>
                  {RANK_LABELS[rank]}
                </option>
              ))}
            </Select>
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Комментарий (обязателен, попадёт в аудит)"
              minLength={3}
              maxLength={500}
              className="w-80"
            />
            <Button
              variant="danger"
              onClick={changeRank}
              disabled={busy || comment.length < 3 || newRank === row.rank}
            >
              Изменить ранг
            </Button>
          </div>
          {newRank === 'GUILD_LEADER' && <p>При передаче действующий Глава станет Рядовым.</p>}
        </div>
      )}

      {canAssignLeader && (
        <div className="mt-4">
          <h3 className="mb-2 font-semibold text-primary">Начислить ДКП: {row.nickname}</h3>
          <fieldset disabled={busy || !!grantAttempt} className="flex flex-wrap gap-2">
            <Field label="Сумма ДКП">
              <Input
                type="number"
                min={1}
                max={2147483647}
                step={1}
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
              />
            </Field>
            <Field label="Комментарий">
              <Input
                maxLength={500}
                value={grantComment}
                onChange={(e) => setGrantComment(e.target.value)}
              />
            </Field>
          </fieldset>
          <p>
            Получатель: {row.nickname}; сумма: {grantAmount || '—'} ДКП.
          </p>
          <Button
            onClick={grant}
            disabled={
              busy ||
              (!grantAttempt &&
                (!Number.isInteger(Number(grantAmount)) ||
                  Number(grantAmount) <= 0 ||
                  Number(grantAmount) > 2147483647 ||
                  grantComment.trim().length < 3))
            }
          >
            {grantAttempt ? 'Повторить начисление' : 'Начислить ДКП'}
          </Button>
        </div>
      )}

      {message && <p className="mt-3 text-sm text-primary">{message}</p>}
      <Button className="mt-4" onClick={onClose} disabled={busy || !!grantAttempt}>
        Закрыть
      </Button>
    </Card>
  );
}
