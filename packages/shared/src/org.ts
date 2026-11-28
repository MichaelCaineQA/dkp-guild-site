import { z } from 'zod';
import { can, type PermissionActor } from './permissions';

const id = z.string().trim().min(1);
const name = z.string().trim().min(1).max(100);
const ids = z
  .array(id)
  .max(100)
  .refine((v) => new Set(v).size === v.length);
export const orgCreateKpSchema = z.object({ name, packIds: ids.default([]) }).strict();
export const orgCreatePackSchema = z
  .object({ name, kpId: id, memberIds: ids.default([]) })
  .strict();
export const orgEditKpSchema = z.object({ name }).strict();
export const orgMoveMemberSchema = z.union([
  z.object({ packId: id }).strict(),
  z.object({ kpId: id }).strict(),
]);
export const orgMovePackSchema = z.object({ kpId: id }).strict();
export const orgLeaderSchema = z.object({ memberId: id.nullable() }).strict();

export function canManageKp(
  actor: PermissionActor,
  action: 'org.edit_kp' | 'org.create_pack',
  kp: { leaderId: string | null },
): boolean {
  return can(actor, action) || isKpLeader(actor, kp);
}

export function canMoveOrgMember(
  actor: PermissionActor,
  kp: { leaderId: string | null },
  member: { kpId: string | null; packId: string | null },
): boolean {
  return (
    can(actor, 'org.move_member') ||
    (isKpLeader(actor, kp) && member.kpId === null && member.packId === null)
  );
}

function isKpLeader(actor: PermissionActor, kp: { leaderId: string | null }): boolean {
  return actor.rank !== null && !!actor.memberId && kp.leaderId === actor.memberId;
}
