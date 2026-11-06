import { z } from 'zod';

export const auditQuerySchema = z
  .object({
    actorMemberId: z.string().min(1).optional(),
    action: z.string().min(1).max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'Начало периода должно быть не позже конца',
    path: ['to'],
  });

export interface AuditRow {
  id: string;
  actorMemberId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  comment: string | null;
  createdAt: string;
}
