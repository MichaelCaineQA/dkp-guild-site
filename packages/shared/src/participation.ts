import { z } from 'zod';
/** Причина отказа от конкретного события необязательна (PLAN 2.1). */
export const participationInputSchema = z
  .object({
    attending: z.boolean(),
    reason: z.string().trim().max(500).default(''),
    absenceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();
export interface ParticipationState {
  invited: boolean;
  attending: boolean;
  canDecline: boolean;
  canAttend: boolean;
  deadlineAt: string;
  absences: { id: string; dateFrom: string; dateTo: string; reason: string }[];
}
export function participationActions(
  event: { startsAt: Date; status: string },
  now: Date,
  deadlineSec: number,
) {
  const deadline = new Date(+event.startsAt - deadlineSec * 1000);
  return {
    deadlineAt: deadline.toISOString(),
    canDecline: event.status === 'PLANNED' && +now <= +deadline,
    canAttend: event.status === 'PLANNED' && +now < +event.startsAt,
  };
}
