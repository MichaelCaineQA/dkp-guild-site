'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COMBAT_ROLES,
  COMBAT_ROLE_LABELS,
  RANKS,
  can,
  type CombatRole,
  type Rank,
} from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';

const RANK_LABELS: Record<Rank, string> = {
  GUILD_LEADER: 'Глава',
  ADMIN: 'Админ',
  OFFICER: 'Офицер',
  MEMBER: 'Рядовой',
};

interface RosterRow {
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
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RosterRow | null>(null);

  const loadRoster = useCallback(async () => {
    const params = new URLSearchParams();
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
  }, [rankFilter, roleFilter]);

  useEffect(() => {
    if (!sessionLoading && user?.memberId) {
      void loadRoster();
    }
  }, [sessionLoading, user, loadRoster]);

  const canManage = useMemo(
    () => user && can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'members.manage'),
    [user],
  );

  if (sessionLoading) {
    return <main style={{ padding: 24 }}>Загрузка…</main>;
  }

  if (!user) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Состав гильдии</h1>
        <p>Раздел доступен членам гильдии после входа.</p>
      </main>
    );
  }

  if (!user.memberId && !user.isAdmin) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Состав гильдии</h1>
        <p>
          Ваш аккаунт ещё не привязан к члену гильдии. Отправьте{' '}
          <a href="/link">заявку на привязку ника</a>.
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Состав гильдии</h1>

      <div className="roster-filters">
        <label>
          Ранг:{' '}
          <select value={rankFilter} onChange={(e) => setRankFilter(e.target.value as Rank | '')}>
            <option value="">все ранги</option>
            {RANKS.map((rank) => (
              <option key={rank} value={rank}>
                {RANK_LABELS[rank]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Роль в бою:{' '}
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as CombatRole | '')}>
            <option value="">все роли</option>
            {COMBAT_ROLES.map((role) => (
              <option key={role} value={role}>
                {COMBAT_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">Всего: {rows.length}</span>
      </div>

      {error && <p className="error">{error}</p>}

      <table className="roster-table">
        <thead>
          <tr>
            <th>Ник</th>
            <th>Ранг</th>
            <th>Роль в бою</th>
            <th>Discord</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => setSelected(row)} className="roster-row">
              <td>{row.nickname}</td>
              <td>{RANK_LABELS[row.rank]}</td>
              <td>{row.combatRole ? COMBAT_ROLE_LABELS[row.combatRole] : '—'}</td>
              <td>{row.discord ?? '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                Никого не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canManage && <CreateMemberForm onCreated={loadRoster} />}

      {selected && (
        <MemberCard
          row={selected}
          canManage={!!canManage}
          canChangeRank={
            !!user &&
            can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'members.change_rank')
          }
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            void loadRoster();
          }}
        />
      )}
    </main>
  );
}

/** Создание члена — офицерам и выше (members.manage). */
function CreateMemberForm({ onCreated }: { onCreated: () => void }) {
  const [nickname, setNickname] = useState('');
  const [combatRole, setCombatRole] = useState<CombatRole | ''>('');
  const [result, setResult] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(null);
    try {
      await api('/members', {
        method: 'POST',
        body: JSON.stringify({ nickname, combatRole: combatRole || null }),
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
    <section className="card">
      <h2>Добавить члена</h2>
      <form onSubmit={submit}>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Игровой ник"
          minLength={2}
          maxLength={40}
          required
        />{' '}
        <select value={combatRole} onChange={(e) => setCombatRole(e.target.value as CombatRole | '')}>
          <option value="">роль в бою —</option>
          {COMBAT_ROLES.map((role) => (
            <option key={role} value={role}>
              {COMBAT_ROLE_LABELS[role]}
            </option>
          ))}
        </select>{' '}
        <button type="submit" disabled={nickname.length < 2}>
          Добавить
        </button>
      </form>
      {result && <p>{result}</p>}
    </section>
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
        body: JSON.stringify({ nickname, combatRole: combatRole || null }),
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
        status === 409 ? 'Такой ранг уже стоит или это последний Глава' : 'Не удалось изменить ранг',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card member-card">
      <h2>{row.nickname}</h2>
      <p className="muted">
        Ранг: {RANK_LABELS[row.rank]} · Роль в бою:{' '}
        {row.combatRole ? COMBAT_ROLE_LABELS[row.combatRole] : '—'}
      </p>

      {canManage && (
        <div className="member-edit">
          <h3>Редактирование</h3>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Игровой ник"
            minLength={2}
            maxLength={40}
          />{' '}
          <select value={combatRole} onChange={(e) => setCombatRole(e.target.value as CombatRole | '')}>
            <option value="">роль в бою —</option>
            {COMBAT_ROLES.map((role) => (
              <option key={role} value={role}>
                {COMBAT_ROLE_LABELS[role]}
              </option>
            ))}
          </select>{' '}
          <button type="button" onClick={save} disabled={busy || nickname.length < 2}>
            Сохранить
          </button>
        </div>
      )}

      {canChangeRank && (
        <div className="member-edit">
          <h3>Смена ранга</h3>
          <select value={newRank} onChange={(e) => setNewRank(e.target.value as Rank)}>
            {RANKS.map((rank) => (
              <option key={rank} value={rank}>
                {RANK_LABELS[rank]}
              </option>
            ))}
          </select>{' '}
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Комментарий (обязателен, попадёт в аудит)"
            minLength={3}
            maxLength={500}
            style={{ width: 320 }}
          />{' '}
          <button
            type="button"
            onClick={changeRank}
            disabled={busy || comment.length < 3 || newRank === row.rank}
          >
            Изменить ранг
          </button>
        </div>
      )}

      {message && <p>{message}</p>}
      <button type="button" onClick={onClose}>
        Закрыть
      </button>
    </section>
  );
}
