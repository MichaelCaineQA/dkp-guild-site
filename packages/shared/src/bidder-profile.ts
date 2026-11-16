import type { CombatRole } from './domain';

export interface BidderProfile {
  combatRole: CombatRole | null;
  preferredItemId: string | null;
}
export type BidderProfiles = Record<string, BidderProfile>;

/** Для вступившего после открытия нет снимка; сохраняется прежний путь обработки. */
export function bidderProfileAtCreation(
  profiles: BidderProfiles,
  memberId: string,
): BidderProfile | null {
  return Object.prototype.hasOwnProperty.call(profiles, memberId) ? profiles[memberId] : null;
}
