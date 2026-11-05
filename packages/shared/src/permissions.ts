import { RANKS, type Rank } from './domain';

/**
 * Матрица прав из docs/PLAN.md, раздел 2.6. Рангов четыре: Глава, Админ,
 * Офицер, Рядовой. «Рейд-лид» — не ранг, а поле ивента: назначенный РЛ
 * получает права ведения конкретного ивента независимо от ранга.
 *
 * Права здесь — декларация для людей и тестов; эндпоинты API вешают их
 * через @RequirePermission (apps/api). «РЛ ивента» разрешается проверкой
 * target.raidLeadId — она появится в ивентах (задачи #8–#10).
 */
export const PERMISSIONS = [
  'members.manage', // создание/редактирование членов (issue #6: офицеры+)
  'members.change_rank', // смена рангов — только Глава/Админ
  'members.view_roster', // состав гильдии — всем членам
  'link_requests.review', // подтверждение заявок на привязку Discord
  'settings.manage', // настройка системы, справочники
  'rules.edit', // страницы правил
  'events.manage', // создание/редактирование ивентов, назначение РЛ
  'events.conduct', // коды, чек-лист, лоты, итоги
  'attendance.manual', // ручные отметки посещения
  'absence.see', // отметка «Увидел» на отсутствиях
  'dkp.penalty', // штрафы и корректировки ДКП
  'items.manage', // справочник предметов, КП и паки
  'auction.bid', // ставки на аукционе
  'profile.view', // профили и статистика
  'profile.edit_own', // свой профиль: роль, прайм-тайм, GS-скрины
  'audit.view', // полный журнал действий — офицерам и выше
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Минимальный ранг для права (Глава и Админ равны по матрице 2.6). */
const MIN_RANK: Record<Permission, Rank> = {
  'members.manage': 'OFFICER',
  'members.change_rank': 'GUILD_LEADER',
  'members.view_roster': 'MEMBER',
  'link_requests.review': 'OFFICER',
  'settings.manage': 'GUILD_LEADER',
  'rules.edit': 'GUILD_LEADER',
  'events.manage': 'OFFICER',
  'events.conduct': 'OFFICER',
  'attendance.manual': 'OFFICER',
  'absence.see': 'OFFICER',
  'dkp.penalty': 'OFFICER',
  'items.manage': 'OFFICER',
  'auction.bid': 'MEMBER',
  'profile.view': 'MEMBER',
  'profile.edit_own': 'MEMBER',
  'audit.view': 'OFFICER',
};

/** Иерархия рангов: у кого больше — тот может больше. */
export const RANK_ORDER: Record<Rank, number> = {
  GUILD_LEADER: 3,
  ADMIN: 3,
  OFFICER: 2,
  MEMBER: 1,
};

/** Кто действует: резервный админ (без Member) действует как высший ранг. */
export interface PermissionActor {
  rank: Rank | null;
  /** true — резервный вход администратора (admin: без Member). */
  isAdmin?: boolean;
  /** id Member актора — для прав «РЛ ивента». */
  memberId?: string | null;
}

/** Действия, которые РЛ ивента может независимо от ранга (матрица 2.6). */
export const RAID_LEAD_ACTIONS: ReadonlySet<Permission> = new Set([
  'events.conduct',
  'attendance.manual',
  'absence.see',
]);

/** Цель действия: ивент (или другое) с назначенным РЛ, если применимо. */
export interface PermissionTarget {
  raidLeadId?: string;
}

export function rankAtLeast(rank: Rank, min: Rank): boolean {
  return RANK_ORDER[rank] >= RANK_ORDER[min];
}

/**
 * Главная проверка прав: can(actor, 'events.conduct', event) — true, если
 * ранг актора достаточен ИЛИ актор — РЛ этого ивента (права «РЛ ивента»
 * из плана 2.6 работают только на назначенных ивентах).
 */
export function can(
  actor: PermissionActor,
  action: Permission,
  target?: PermissionTarget,
): boolean {
  // Права «РЛ ивента» действуют на ивентах, где актор назначен рейд-лидом.
  if (
    target?.raidLeadId !== undefined &&
    actor.memberId !== undefined &&
    target.raidLeadId === actor.memberId &&
    RAID_LEAD_ACTIONS.has(action)
  ) {
    return true;
  }

  if (actor.isAdmin) {
    return true; // резервный админ — технический доступ полного уровня (2.6)
  }
  if (actor.rank === null) {
    return false; // вошёл, но не привязан к члену гильдии
  }
  return rankAtLeast(actor.rank, MIN_RANK[action]);
}

/** Список прав актора — для UI (подсветка доступных действий). */
export function permissionsOf(actor: PermissionActor): Permission[] {
  return PERMISSIONS.filter((permission) => can(actor, permission));
}

export type { Rank };
export { RANKS };
