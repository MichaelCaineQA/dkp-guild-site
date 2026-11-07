import type { ReactNode } from 'react';
import {
  AUDIT_ACTION_LABELS,
  COMBAT_ROLE_LABELS,
  RANK_LABELS,
  formatWeapons,
  type AuditRow,
  type DashboardEvent,
  type DashboardTeamMember,
} from '@dkp/shared';
import { TextLink } from './controls';
import { Muted } from './layout';
import { Avatar } from '../avatar';
export function DashboardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 md:h-[calc(100dvh-11rem)] md:min-h-[560px] md:grid-cols-2 md:grid-rows-2">
      {children}
    </div>
  );
}
export function DashboardWidget({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex min-h-0 min-w-0 flex-col rounded-xl border border-line bg-surface shadow-sm"
    >
      <h2 className="border-b border-line px-5 py-4 text-lg font-semibold">{title}</h2>
      <div className="min-h-0 space-y-4 p-5 md:overflow-y-auto">{children}</div>
    </section>
  );
}
export function DashboardEventButton({
  event,
  past,
  onClick,
}: {
  event: DashboardEvent;
  past: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-wrap items-start gap-3 rounded-lg border border-line px-3 py-2 text-left hover:bg-surface-muted ${past ? 'opacity-50' : ''}`}
    >
      <time className="tabular-nums" dateTime={event.startsAt}>
        {new Date(event.startsAt).toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </time>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-medium">{event.name || event.eventTypeName}</span>
        <Muted>{event.eventTypeName}</Muted>
      </span>
    </button>
  );
}
export function TeamMemberLink({ member }: { member: DashboardTeamMember }) {
  return (
    <a
      href={`/profiles/${encodeURIComponent(member.id)}`}
      className="flex min-w-0 items-center gap-3 rounded-lg p-2 hover:bg-surface-muted"
    >
      <Avatar avatar={member.avatar} avatarColor={member.avatarColor} nickname={member.nickname} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          <span className="break-all">{member.nickname}</span>
          {member.leader && (
            <span title="Лидер пака" aria-label="Лидер пака" className="text-slate-300">
              ♛
            </span>
          )}
          <span className="text-xs text-secondary">{RANK_LABELS[member.rank]}</span>
        </span>
        <span className="block text-sm text-secondary">
          {formatWeapons(member.weapons)} ·{' '}
          {member.combatRole ? COMBAT_ROLE_LABELS[member.combatRole] : 'Роль не указана'}
        </span>
        {'gearScore' in member && (
          <span className="text-sm">GS: {member.gearScore ?? 'не указан'}</span>
        )}
      </span>
    </a>
  );
}
export function AuditPreview({ entries }: { entries: AuditRow[] }) {
  return (
    <>
      <ul className="space-y-3 text-sm">
        {entries.map((row) => (
          <li key={row.id} className="border-b border-line pb-3 last:border-0">
            <p>
              <strong>{row.actorName ?? 'Система'}</strong> ·{' '}
              {AUDIT_ACTION_LABELS[row.action] ?? 'Действие'}
            </p>
            {row.comment && <p className="break-words text-secondary">{row.comment}</p>}
            <time className="text-xs text-secondary" dateTime={row.createdAt}>
              {new Date(row.createdAt).toLocaleString('ru-RU')}
            </time>
          </li>
        ))}
      </ul>
      <TextLink href="/audit">Перейти в лог действий</TextLink>
    </>
  );
}
