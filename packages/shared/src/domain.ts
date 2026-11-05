import { z } from 'zod';

/** Роли в бою — поле профиля игрока (docs/PLAN.md, раздел 2.5). */
export const COMBAT_ROLES = ['DPS', 'HEALER', 'TANK'] as const;
export type CombatRole = (typeof COMBAT_ROLES)[number];

export const COMBAT_ROLE_LABELS: Record<CombatRole, string> = {
  DPS: 'ДД',
  HEALER: 'Хил',
  TANK: 'Танк',
};

/** Ранги гильдии (docs/PLAN.md, раздел 2.6). РЛ — не ранг, а поле ивента. */
export const RANKS = ['GUILD_LEADER', 'ADMIN', 'OFFICER', 'MEMBER'] as const;
export type Rank = (typeof RANKS)[number];

/** Русские подписи рангов — единый источник для UI (язык интерфейса — русский). */
export const RANK_LABELS: Record<Rank, string> = {
  GUILD_LEADER: 'Глава',
  ADMIN: 'Админ',
  OFFICER: 'Офицер',
  MEMBER: 'Рядовой',
};

export const EVENT_MODES = ['PVE', 'PVP'] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const EVENT_STATUSES = ['PLANNED', 'RUNNING', 'FINISHED', 'CANCELLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_SCOPES = ['GUILD', 'KP', 'PACK'] as const;
export type EventScope = (typeof EVENT_SCOPES)[number];

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'LEFT_EARLY',
  'NO_SHOW',
  'EXCUSED_ABSENCE',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * Типы операций журнала ДКП. Журнал append-only: баланс вычисляется суммой
 * операций, ничего не удаляется и не редактируется (docs/PLAN.md, раздел 2.2).
 */
export const DKP_ENTRY_TYPES = [
  'CHECKIN_EARN',
  'MANUAL_EARN',
  'AUCTION_SPEND',
  'ADJUSTMENT',
] as const;
export type DkpEntryType = (typeof DKP_ENTRY_TYPES)[number];

export interface DkpEntry {
  id: string;
  memberId: string;
  type: DkpEntryType;
  /** Положительное — начисление, отрицательное — трата/корректировка. */
  amount: number;
  createdAt: string;
  comment?: string;
}

/** Создание ивента: плата ДКП фиксируется при создании (docs/PLAN.md, решение 1). */
export const createEventSchema = z.object({
  eventTypeId: z.string().min(1),
  mode: z.enum(EVENT_MODES),
  scope: z.enum(EVENT_SCOPES).default('GUILD'),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  dkpReward: z.number().int().positive(),
  raidLeadId: z.string().min(1),
  place: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;
