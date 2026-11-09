import { z } from 'zod';

export const auditQuerySchema = z
  .object({
    entityType: z.string().min(1).max(100).optional(),
    system: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    actorMemberId: z.string().min(1).optional(),
    action: z.string().min(1).max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !query.system || !query.actorMemberId, { message: 'Выберите одного автора' })
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
  /** Текущее отображаемое имя сущности участника; ID остаётся ключом. */
  entityName?: string | null;
  comment: string | null;
  createdAt: string;
}

/** Плоский список сущностей, включая ещё не включённые разделы этапов 2/3. */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  DkpEntry: 'ДКП',
  KP: 'КП',
  Pack: 'Пак',
  Auction: 'Лот',
  LootDrop: 'Дроп',
  Event: 'Событие',
  EventSeries: 'Серия событий',
  EventType: 'Тип события',
  Item: 'Предмет',
  Absence: 'Отсутствие',
  Attendance: 'Посещение',
  Member: 'Участник',
  User: 'Аккаунт',
  MemberLinkRequest: 'Заявка на вступление',
  RulesPage: 'Страница правил',
  Setting: 'Настройка',
  Guild: 'Гильдия',
  GearScoreRecord: 'Обновление GS',
  Screenshot: 'Скриншот',
};
