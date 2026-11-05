'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface AbsentMember {
  id: string;
  memberId: string;
  memberName: string;
  reason: string;
}

/**
 * Список оформленно отсутствующих по ивенту (план 2.3): показывается
 * в карточке ивента и на странице проведения; РЛ их не отмечает вручную —
 * статус EXCUSED_ABSENCE ставится автоматически при закрытии ивента.
 */
export function AbsentMembersPanel({ eventStartsAt }: { eventStartsAt: string }) {
  const [absent, setAbsent] = useState<AbsentMember[] | null>(null);

  useEffect(() => {
    api<AbsentMember[]>(`/absences/for-event?startsAt=${encodeURIComponent(eventStartsAt)}`)
      .then(setAbsent)
      .catch(() => setAbsent([]));
  }, [eventStartsAt]);

  if (!absent || absent.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-lg border border-warning/40 bg-warning-soft p-3">
      <p className="text-xs font-semibold text-warning">
        Отсутствуют по уважительной ({absent.length}) — не отмечаются вручную:
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 text-sm">
        {absent.map((member) => (
          <li key={member.id}>
            <span className="font-medium">{member.memberName}</span>
            <span className="text-secondary"> — {member.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
