import type { CombatRole } from './domain';

export interface BidderProfile {
  combatRole: CombatRole | null;
  preferredItemId: string | null;
  /**
   * Желаемое архибосс-оружие (issue #208); optional — снимки, записанные
   * до него, поля не содержат (нормализуется в null при чтении).
   */
  preferredArchbossItemId?: string | null;
}
export type BidderProfiles = Record<string, BidderProfile>;

/**
 * Для вступившего после открытия нет снимка; сохраняется прежний путь
 * обработки. Старые снимки (до #208) не содержали archboss-поля —
 * недостающее нормализуется в null, чтобы потребители не видели undefined.
 */
export function bidderProfileAtCreation(
  profiles: BidderProfiles,
  memberId: string,
): BidderProfile | null {
  if (!Object.prototype.hasOwnProperty.call(profiles, memberId)) return null;
  const profile = profiles[memberId];
  return {
    combatRole: profile.combatRole,
    preferredItemId: profile.preferredItemId ?? null,
    preferredArchbossItemId: profile.preferredArchbossItemId ?? null,
  };
}

/**
 * Предпочитался ли предмет игроком по снимку создания лота — обычное
 * пожелание или архибосс-оружие (issue #208): скидка действует на оба.
 */
export function snapshotPrefersItem(
  profile: Pick<BidderProfile, 'preferredItemId' | 'preferredArchbossItemId'>,
  itemId: string,
): boolean {
  return profile.preferredItemId === itemId || profile.preferredArchbossItemId === itemId;
}
