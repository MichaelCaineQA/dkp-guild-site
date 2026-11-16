import type { BidderProfiles, CombatRole } from '@dkp/shared';

export interface BidderProfilesDb {
  member: {
    findMany(args: {
      select: { id: true; combatRole: true; preferredItemId: true };
    }): Promise<
      Array<{ id: string; combatRole: CombatRole | null; preferredItemId: string | null }>
    >;
  };
}
export async function snapshotBidderProfiles(db: BidderProfilesDb): Promise<BidderProfiles> {
  const members = await db.member.findMany({
    select: { id: true, combatRole: true, preferredItemId: true },
  });
  return Object.fromEntries(
    members.map(({ id, combatRole, preferredItemId }) => [id, { combatRole, preferredItemId }]),
  );
}
