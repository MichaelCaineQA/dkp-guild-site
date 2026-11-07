'use client';
import { useEffect, useState } from 'react';
import {
  COMBAT_ROLE_LABELS,
  RANK_LABELS,
  formatWeapons,
  type CombatRole,
  type Rank,
  type Weapon,
} from '@dkp/shared';
import { api } from '../lib/api';
import { Avatar } from './avatar';

type Member = {
  avatar?: string | null;
  avatarColor?: string | null;
  id: string;
  nickname: string;
  rank: Rank;
  weapons: Weapon[];
  combatRole: CombatRole | null;
  packId: string | null;
  packName: string | null;
  kpId: string | null;
  kpName: string | null;
  gearScore: number | null;
  attending: boolean;
};

export function EventRoster({ eventId }: { eventId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setMembers(null);
    setError(false);
    api<Member[]>(`/events/${eventId}/roster`)
      .then((rows) => {
        if (active) setMembers(rows);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [eventId]);
  const groups = new Map<string, Member[]>();
  for (const member of members ?? []) {
    const key = member.kpId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  const count = (rows: Member[]) => `${rows.filter((m) => m.attending).length}/${rows.length}`;
  return (
    <section className="mt-4">
      <h3 className="font-semibold">Участники {members && count(members)}</h3>
      {error && <p>Не удалось загрузить состав</p>}
      {!error && !members && <p>Загрузка состава…</p>}
      {members?.length === 0 && <p>Нет приглашённых участников</p>}
      {[...groups.entries()].map(([kpId, rows]) => {
        const packs = new Map<string, Member[]>();
        for (const member of rows) {
          const key = member.packId ?? '';
          packs.set(key, [...(packs.get(key) ?? []), member]);
        }
        return (
          <details key={kpId} open>
            <summary>
              {rows[0]?.kpName ?? 'Без КП'} — {count(rows)}
            </summary>
            {[...packs.entries()].map(([packId, pack]) => (
              <details key={packId} open className="ml-3">
                <summary>
                  {pack[0]?.packName ?? 'Без пака'} — {count(pack)}
                </summary>
                <ul>
                  {pack.map((member) => (
                    <li
                      key={member.id}
                      className="ml-3 flex min-w-0 items-center gap-2 py-1 text-sm"
                    >
                      <a
                        href={`/profiles/${encodeURIComponent(member.id)}`}
                        className="shrink-0"
                        aria-label={`Профиль: ${member.nickname}`}
                      >
                        <Avatar
                          avatar={member.avatar}
                          avatarColor={member.avatarColor}
                          nickname={member.nickname}
                        />
                      </a>
                      <span className="min-w-0 break-words">
                        <a
                          href={`/profiles/${encodeURIComponent(member.id)}`}
                          className="font-medium"
                        >
                          {member.nickname}
                        </a>{' '}
                        · {RANK_LABELS[member.rank]} · {formatWeapons(member.weapons)} ·{' '}
                        {member.combatRole
                          ? COMBAT_ROLE_LABELS[member.combatRole]
                          : 'Роль не указана'}
                        {member.gearScore !== null && ` · GS ${member.gearScore}`} ·{' '}
                        {member.attending ? 'Будет' : 'Не будет'}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </details>
        );
      })}
    </section>
  );
}
