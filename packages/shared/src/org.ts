import { z } from 'zod';

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
export const orgMoveMemberSchema = z.object({ packId: id }).strict();
export const orgMovePackSchema = z.object({ kpId: id }).strict();
export const orgLeaderSchema = z.object({ memberId: id.nullable() }).strict();
