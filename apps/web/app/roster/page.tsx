'use client';

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
import {
  Badge,
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
  WeaponPicker,
} from '../../components/ui';

interface RosterRow {
  weapons: Weapon[];
  id: string;
  nickname: string;
  rank: Rank;
  combatRole: CombatRole | null;
  discord: string | null;
}

/** «Состав гильдии» (issue #6): таблица с фильтрами, доступна всем членам. */
export default function RosterPage() {
  const { user, loading: sessionLoading } = useSession();
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [rankFilter, setRankFilter] = useState<Rank | ''>('');
  const [roleFilter, setRoleFilter] = useState<CombatRole | ''>('');
  const [weaponFilter, setWeaponFilter] = useState<Weapon | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RosterRow | null>(null);
  // Сортировка столбцов + пагинация (ревью владельца, п.9)
  const [sortKey, setSortKey] = useState<keyof RosterRow | null>(null);
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
    if (!sortKey) {
      return rows;
    }
    return [...rows].sort((a, b) => {
      const av =
        sortKey === 'weapons'
          ? formatWeapons(a.weapons ?? [])
          : sortKey === 'rank'
            ? (RANK_ORDER_UI[a.rank] ?? 0)
            : (a[sortKey] ?? '');
      const bv =
        sortKey === 'weapons'
          ? formatWeapons(b.weapons ?? [])
          : sortKey === 'rank'
            ? (RANK_ORDER_UI[b.rank] ?? 0)
            : (b[sortKey] ?? '');
      const cmp = String(av).localeCompare(String(bv), 'ru');
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, sortKey, sortAsc]);

  function toggleSort(key: keyof RosterRow) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
    setPageOffset(0);
  }

  function sortIndicator(key: keyof RosterRow) {
    if (sortKey !== key) {
      return '↕';
    }
    return sortAsc ? '↑' : '↓';
  }

  const loadRoster = useCallback(async () => {
    const params = new URLSearchParams();
    if (weaponFilter) params.set('weapon', weaponFilter);
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
  }, [rankFilter, roleFilter, weaponFilter]);

  useEffect(() => {
    if (!sessionLoading && user?.memberId) {
      void loadRoster();
    }
  }, [sessionLoading, user, loadRoster]);

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

      <div className="mb-4 flex flex-wrap items-center gap-4">
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
        <Muted>Всего: {rows.length}</Muted>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {sortedRows.slice(pageOffset, pageOffset + PAGE_SIZE).map((row) => (
              <Table.Row key={row.id} onClick={() => setSelected(row)}>
                <Table.Td className="font-medium">
                  <a
                    className="text-accent hover:underline"
                    href={`/profiles/${encodeURIComponent(row.id)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.nickname}
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
              </Table.Row>
            ))}
            {rows.length === 0 && (
              <tr>
                <Table.Td colSpan={5}>
                  <Muted>Никого не найдено</Muted>
                </Table.Td>
              </tr>
            )}
          </tbody>
        </Table>
        {rows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line p-3 text-sm">
            <Muted>
              {pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, rows.length)} из {rows.length}
            </Muted>
            <span className="flex gap-2">
              <Button
                disabled={pageOffset === 0}
                onClick={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}
              >
                ←
              </Button>
              <Button
                disabled={pageOffset + PAGE_SIZE >= rows.length}
                onClick={() => setPageOffset(pageOffset + PAGE_SIZE)}
              >
                →
              </Button>
            </span>
          </div>
        )}
      </Card>

      {canManage && <CreateMemberForm onCreated={loadRoster} />}

      {selected && (
        <MemberCard
          row={selected}
          canManage={!!canManage}
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

/** Создание члена — офицерам и выше (members.manage). */
function CreateMemberForm({ onCreated }: { onCreated: () => void }) {
  const [weapons, setWeapons] = useState<Array<Weapon | ''>>([]);
  const [nickname, setNickname] = useState('');
  const [combatRole, setCombatRole] = useState<CombatRole | ''>('');
  const [result, setResult] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);
    try {
      await api('/members', {
        method: 'POST',
        body: JSON.stringify({ nickname, combatRole, weapons }),
      });
      setNickname('');
      setResult('Член добавлен');
      onCreated();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setResult(status === 409 ? 'Член с таким ником уже есть' : 'Не получилось добавить');
    }
  };

  return (
    <Card className="mt-4">
      <h2 className="mb-3 text-lg font-semibold text-primary">Добавить члена</h2>
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
        <Input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Игровой ник"
          minLength={2}
          maxLength={40}
          required
        />
        <Select
          value={combatRole}
          onChange={(e) => setCombatRole(e.target.value as CombatRole | '')}
        >
          <option value="">роль —</option>
          {COMBAT_ROLES.map((role) => (
            <option key={role} value={role}>
              {COMBAT_ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
        <WeaponPicker value={weapons} onChange={setWeapons} />
        <Button
          type="submit"
          variant="primary"
          disabled={
            nickname.length < 2 ||
            !combatRole ||
            weapons.length !== 2 ||
            weapons.some((weapon) => !weapon)
          }
        >
          Добавить
        </Button>
      </form>
      {result && <p className="mt-2 text-sm text-primary">{result}</p>}
    </Card>
  );
}

/** Карточка члена: редактирование (офицер+) и смена ранга (Глава/Админ). */
function MemberCard({
  row,
  canManage,
  canChangeRank,
  onClose,
  onChanged,
}: {
  row: RosterRow;
  canManage: boolean;
  canChangeRank: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [nickname, setNickname] = useState(row.nickname);
  const [weapons, setWeapons] = useState<Array<Weapon | ''>>(row.weapons ?? []);
  const [combatRole, setCombatRole] = useState<CombatRole | ''>(row.combatRole ?? '');
  const [newRank, setNewRank] = useState<Rank>(row.rank);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/members/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nickname, combatRole, weapons }),
      });
      setMessage('Сохранено');
      onChanged();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setMessage(status === 409 ? 'Такой ник уже занят' : 'Не удалось сохранить');
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

  return (
    <Card className="mt-4">
      <h2 className="text-xl font-semibold text-primary">{row.nickname}</h2>
      <p className="mt-1 text-sm text-secondary">
        Ранг: {RANK_LABELS[row.rank]} · Роль:{' '}
        {row.combatRole ? COMBAT_ROLE_LABELS[row.combatRole] : '—'}
      </p>
      <p>Класс: {formatWeapons(row.weapons ?? [])}</p>

      {canManage && (
        <div className="mt-4">
          <h3 className="mb-2 font-semibold text-primary">Редактирование</h3>
          <WeaponPicker value={weapons} onChange={setWeapons} />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Игровой ник"
              minLength={2}
              maxLength={40}
            />
            <Select
              value={combatRole}
              onChange={(e) => setCombatRole(e.target.value as CombatRole | '')}
            >
              <option value="">роль —</option>
              {COMBAT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {COMBAT_ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
            <Button onClick={save} disabled={busy || nickname.length < 2}>
              Сохранить
            </Button>
          </div>
        </div>
      )}

      {canChangeRank && (
        <div className="mt-4">
          <h3 className="mb-2 font-semibold text-primary">Смена ранга</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={newRank} onChange={(e) => setNewRank(e.target.value as Rank)}>
              {/* Глава и Админ не назначаются (решение владельца) */}
              {RANKS.filter((rank) => rank !== 'GUILD_LEADER' && rank !== 'ADMIN').map((rank) => (
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
        </div>
      )}

      {message && <p className="mt-3 text-sm text-primary">{message}</p>}
      <Button className="mt-4" onClick={onClose}>
        Закрыть
      </Button>
    </Card>
  );
}
