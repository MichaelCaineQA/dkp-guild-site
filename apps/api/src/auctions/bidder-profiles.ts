import type { BidderProfiles, CombatRole } from '@dkp/shared';

export interface BidderProfilesDb {
  member: {
    findMany(args: {
      select: {
        id: true;
        combatRole: true;
        preferredItemId: true;
        preferredArchbossItemId: true;
      };
    }): Promise<
      Array<{
        id: string;
        combatRole: CombatRole | null;
        preferredItemId: string | null;
        preferredArchbossItemId: string | null;
      }>
    >;
  };
}
export async function snapshotBidderProfiles(db: BidderProfilesDb): Promise<BidderProfiles> {
  const members = await db.member.findMany({
    select: { id: true, combatRole: true, preferredItemId: true, preferredArchbossItemId: true },
  });
  return Object.fromEntries(
    members.map(({ id, combatRole, preferredItemId, preferredArchbossItemId }) => [
      id,
      { combatRole, preferredItemId, preferredArchbossItemId },
    ]),
  );
}
