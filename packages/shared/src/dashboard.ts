import type { AuditRow } from './audit';
import type { CombatRole, EventMode, Rank } from './domain';
import type { Weapon } from './weapons';
/** Календарный день виджета общий для гильдии: Москва, без зависимости от TZ процесса. */
export function getMoscowDayBounds(now: Date) {
  const shifted = new Date(now.getTime() + 3 * 60 * 60_000);
  const start = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      3 * 60 * 60_000,
  );
  return { start, end: new Date(start.getTime() + 24 * 60 * 60_000) };
}
/** Текущие и ближайшие будущие, остаток мест — последние прошедшие; старые уходят. */
export function selectDashboardEvents<
  T extends { startsAt: Date | string; endsAt: Date | string; status?: string },
>(events: T[], now: Date): T[] {
  const { start, end } = getMoscowDayBounds(now);
  const today = events
    .filter((e) => +new Date(e.startsAt) >= +start && +new Date(e.startsAt) < +end)
    .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const ended = (e: T) =>
    +new Date(e.endsAt) <= +now || e.status === 'FINISHED' || e.status === 'CANCELLED';
  const upcoming = today.filter((e) => !ended(e)).slice(0, 5);
  const slots = 5 - upcoming.length;
  const recent = slots > 0 ? today.filter(ended).slice(-slots) : [];
  return [...recent, ...upcoming].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
}
export function sortTeamMembers<
  T extends { id: string; createdAt: Date | string; packJoinedAt: Date | string | null },
>(members: T[], leaderId: string | null): T[] {
  return [...members].sort(
    (a, b) =>
      Number(b.id === leaderId) - Number(a.id === leaderId) ||
      +new Date(a.packJoinedAt ?? a.createdAt) - +new Date(b.packJoinedAt ?? b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export interface DashboardEvent {
  id: string;
  name: string;
  eventTypeId: string;
  eventTypeName: string;
  mode: EventMode;
  status: string;
  startsAt: string;
  endsAt: string;
  dkpReward: number;
  raidLeadId: string;
  raidLeadName: string;
  place: string | null;
  notes: string | null;
}
export interface DashboardTeamMember {
  id: string;
  nickname: string;
  rank: Rank;
  combatRole: CombatRole | null;
  weapons: Weapon[];
  leader: boolean;
  gearScore?: number | null;
}
export interface DashboardData {
  generatedAt: string;
  events: DashboardEvent[];
  team: { id: string; name: string; members: DashboardTeamMember[] } | null;
  /** Лоты появятся вместе с аукционом на этапе 2. */
  auction: null;
  audit: AuditRow[] | null;
  gameTime: {
    gameTimeAnchor: string;
    gameTimeDayMinutes: number;
    gameTimeNightMinutes: number;
  } | null;
}
