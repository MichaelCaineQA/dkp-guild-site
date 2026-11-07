import * as shared from '@dkp/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';

export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
export const str: SchemaObject = { type: 'string' };
export const num: SchemaObject = { type: 'integer' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const nullable = (schema: SchemaObject): SchemaObject => ({ ...schema, nullable: true });
export const array = (items: SchemaObject | ReferenceObject): SchemaObject => ({
  type: 'array',
  items,
});
export const object = (
  properties: Record<string, SchemaObject | ReferenceObject>,
  required = Object.keys(properties),
): SchemaObject => ({ type: 'object', properties, required });
const enumeration = (values: readonly string[]): SchemaObject => ({
  type: 'string',
  enum: [...values],
});

/** Схемы входа строятся из той же валидации, которую используют сервисы. */
const inputs: Record<string, unknown> = {
  CreateMember: shared.createMemberSchema,
  UpdateMember: shared.updateMemberSchema,
  ChangeRank: shared.changeRankSchema,
  RosterQuery: shared.rosterQuerySchema,
  CreateLinkRequest: shared.createLinkRequestSchema,
  SessionUser: shared.sessionUserSchema,
  CreateEvent: shared.createEventApiSchema,
  UpdateEvent: shared.updateEventSchema,
  CreateEventSeries: shared.createEventSeriesSchema,
  ChangeEventStatus: shared.changeEventStatusSchema,
  EventsQuery: shared.eventsQuerySchema,
  WeekQuery: shared.weekQuerySchema,
  SubmitCheckIn: shared.submitCheckInSchema,
  SetAttendance: shared.setAttendanceSchema,
  ManualCheckIn: shared.manualCheckInSchema,
  ManualDkp: shared.manualDkpSchema,
  CreateAbsence: shared.createAbsenceSchema,
  DkpQuery: shared.dkpQuerySchema,
  AuditQuery: shared.auditQuerySchema,
  UpdateOwnProfile: shared.updateOwnProfileSchema,
  UpdateRules: shared.updateRulesSchema,
  RestoreRules: shared.restoreRulesSchema,
  GameTimeSettings: shared.gameTimeSettingsSchema,
};
// Не разворачиваем union всех Zod-типов shared в типах конвертера.
function convert(schema: unknown): SchemaObject {
  return zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as SchemaObject;
}
const generated = Object.fromEntries(
  Object.entries(inputs).map(([name, schema]) => {
    const converted = convert(schema);
    // Zod refinements не представимы автоматически в JSON Schema.
    const weapons = converted.properties?.weapons as SchemaObject | undefined;
    if (weapons) {
      weapons.uniqueItems = true;
      weapons.description = 'Два разных оружия RU-сервера.';
      weapons.example = [shared.WEAPONS[0], shared.WEAPONS[1]];
    }
    return [name, converted];
  }),
);
const rank = enumeration(shared.RANKS);
const role = nullable(enumeration(shared.COMBAT_ROLES));
const weapons = {
  ...array(enumeration(shared.WEAPONS)),
  description: 'У старых записей возможен пустой массив.',
  example: [shared.WEAPONS[0], shared.WEAPONS[1]],
};
const roster = { id: str, nickname: str, rank, combatRole: role, weapons, discord: nullable(str) };
const event = {
  name: str,
  id: str,
  eventTypeId: str,
  eventTypeName: str,
  mode: enumeration(shared.EVENT_MODES),
  status: enumeration(shared.EVENT_STATUSES),
  startsAt: date,
  endsAt: date,
  dkpReward: num,
  raidLeadId: str,
  raidLeadName: str,
  place: nullable(str),
  notes: nullable(str),
};
const entry = {
  id: str,
  type: enumeration(shared.DKP_ENTRY_TYPES),
  amount: num,
  comment: nullable(str),
  eventId: nullable(str),
  createdAt: date,
};
const window = {
  phase: enumeration(['START', 'END']),
  windowState: enumeration(['NOT_OPEN_YET', 'ACTIVE', 'CLOSED']),
};
const settings = Object.fromEntries(
  Object.entries(shared.SETTINGS_REGISTRY).map(([key, meta]) => [
    key,
    { ...convert(meta.schema), description: meta.label },
  ]),
);

export const schemas: Record<string, SchemaObject> = {
  ...generated,
  WeekEvent: object({ ...event, invitedCount: num, attendingCount: num }),
  DashboardTeamMember: object(
    {
      id: str,
      nickname: str,
      rank,
      combatRole: role,
      weapons,
      leader: { type: 'boolean' },
      gearScore: nullable(num),
    },
    ['id', 'nickname', 'rank', 'combatRole', 'weapons', 'leader'],
  ),
  Dashboard: object({
    generatedAt: date,
    events: array(ref('Event')),
    team: nullable(object({ id: str, name: str, members: array(ref('DashboardTeamMember')) })),
    auction: { type: 'object', nullable: true, enum: [null] },
    audit: { ...array(ref('AuditEntry')), nullable: true },
    gameTime: nullable(
      object({ gameTimeAnchor: date, gameTimeDayMinutes: num, gameTimeNightMinutes: num }),
    ),
  }),
  Ok: object({ ok: { type: 'boolean', enum: [true] } }),
  Id: object({ id: str }),
  Error: object({ statusCode: num, message: { oneOf: [str, array(str)] }, error: str }, [
    'statusCode',
    'message',
  ]),
  Health: object({
    status: { type: 'string', enum: ['ok'] },
    db: enumeration(['up', 'down']),
    uptime: { type: 'number' },
  }),
  CombatRoles: object(
    Object.fromEntries(
      shared.COMBAT_ROLES.map((key) => [
        key,
        { type: 'string', enum: [shared.COMBAT_ROLE_LABELS[key]] },
      ]),
    ),
  ),
  Me: object({ user: ref('SessionUser') }),
  AdminLogin: object({ login: str, password: { type: 'string', format: 'password' } }, []),
  LoginResult: object({ ok: { type: 'boolean' } }),
  TestLogin: object({ username: { type: 'string', description: 'Имя начинается с test-.' } }, []),
  TestLoginResult: object({ ok: { type: 'boolean' }, error: str }, ['ok']),
  ScreenshotUpload: object({ file: { type: 'string', format: 'binary' } }),
  MyLinkRequest: object({
    request: { type: 'object', allOf: [ref('LinkRequest')], nullable: true },
  }),
  LinkRequest: object(
    {
      id: str,
      nickname: str,
      combatRole: role,
      weapons,
      gearScore: nullable(num),
      screenshotIds: array({ type: 'string', format: 'uuid' }),
      createdAt: date,
      user: object({ username: str }),
    },
    ['id', 'nickname', 'combatRole', 'weapons', 'gearScore', 'screenshotIds', 'createdAt'],
  ),
  RosterMember: object(roster),
  Member: object({
    id: str,
    nickname: str,
    rank,
    combatRole: role,
    weapons,
    userId: nullable(str),
    packId: nullable(str),
    createdAt: date,
  }),
  Event: object(event),
  EventDetail: object({ ...event, seriesId: nullable(str) }),
  EventStatus: object({ id: str, status: enumeration(shared.EVENT_STATUSES) }),
  CreatedSeries: object({ seriesId: str, created: num }),
  DeletedSeries: object({ deleted: num }),
  PlayerCheckIn: object({ ...window, choices: array(str), status: str }),
  RaidLeadCheckIn: object({ ...window, code: str, windowOpensAt: date, windowClosesAt: date }),
  CheckInResult: object({ result: enumeration(['PASSED', 'FAILED']) }),
  ChecklistRow: object({
    memberId: str,
    memberName: str,
    attendanceStatus: nullable(str),
    checkinStart: str,
    checkinEnd: str,
    dkpEarned: num,
  }),
  Absence: object({
    id: str,
    memberId: str,
    memberName: str,
    dateFrom: date,
    dateTo: date,
    reason: str,
    status: str,
    seenBy: array(str),
  }),
  EventAbsence: object({ id: str, memberId: str, memberName: str, reason: str }),
  DkpEntry: object({ ...entry, memberId: str, memberName: str }),
  DkpPage: object({ entries: array(ref('DkpEntry')), total: num }),
  Balance: object({ memberId: str, memberName: str, balance: num }),
  AuditEntry: object({
    id: str,
    actorMemberId: nullable(str),
    actorName: nullable(str),
    action: str,
    entityType: str,
    entityId: str,
    comment: nullable(str),
    createdAt: date,
  }),
  AuditPage: object({ entries: array(ref('AuditEntry')), total: num }),
  Profile: object(
    {
      ...roster,
      balance: num,
      recentEntries: { ...array(object(entry)), maxItems: 10 },
      gearScore: {
        ...nullable(
          object({
            value: num,
            screenshotIds: array({ type: 'string', format: 'uuid' }),
            createdAt: date,
          }),
        ),
        description:
          'Поле отсутствует у пользователей без права на GS. У владельца и Главы/Админа — последняя запись либо null.',
      },
    },
    [...Object.keys(roster), 'balance', 'recentEntries'],
  ),
  RulesPage: object({
    slug: enumeration(shared.RULES_SLUGS),
    title: str,
    contentMd: str,
    version: num,
    updatedAt: date,
  }),
  RulesVersionSummary: object({ version: num, createdAt: date }),
  RulesVersion: object({
    id: str,
    pageSlug: enumeration(shared.RULES_SLUGS),
    contentMd: str,
    version: num,
    createdAt: date,
  }),
  Settings: object(settings),
  UpdateSettings: { ...object(settings, []), additionalProperties: false },
  GuildGameTime: object({
    ...generated.GameTimeSettings.properties,
    id: str,
    name: str,
    createdAt: date,
  }),
  EventType: object({ id: str, name: str }),
  EventTypeInput: object({
    name: {
      type: 'string',
      minLength: 2,
      maxLength: 40,
      description: 'После удаления пробелов по краям.',
    },
  }),
};
const manualAmount = schemas.ManualDkp.properties?.amount as SchemaObject;
manualAmount.not = { enum: [0] };
manualAmount.example = 1;
(schemas.SubmitCheckIn.properties!.code as SchemaObject).example = '123';
for (const name of ['CreateMember', 'ChangeRank']) {
  const assignedRank = schemas[name].properties?.rank as SchemaObject;
  assignedRank.enum = ['OFFICER', 'MEMBER'];
  assignedRank.example = 'MEMBER';
}

const fieldDescriptions: Record<string, string> = {
  nickname: 'Игровой ник участника.',
  combatRole: 'Боевая роль: DPS — ДД, HEALER — хил, TANK — танк.',
  weapons: 'Оружие RU-сервера.',
  comment: 'Комментарий к действию; сохраняется в аудите.',
  dkpReward: 'Плата ДКП за ивент, фиксируется при создании.',
  startsAt: 'Начало ивента (ISO 8601 с часовым поясом).',
  endsAt: 'Конец ивента, позже начала (ISO 8601 с часовым поясом).',
  raidLeadId: 'Идентификатор участника, назначенного РЛ.',
  eventTypeId: 'Идентификатор типа ивента из /event-types.',
  memberId: 'Идентификатор участника из /members.',
  eventId: 'Идентификатор ивента из /events.',
  weekdays: 'Дни недели в UTC: 0 — воскресенье, 6 — суббота.',
  weeks: 'Число недель серии, включая первую.',
  expectedVersion: 'Текущая версия страницы; при несовпадении возвращается 409.',
  sourceVersion: 'Версия, из которой восстановить текст новой публикацией.',
  contentMd: 'Текст страницы в Markdown.',
  limit: 'Размер страницы.',
  offset: 'Число пропускаемых записей.',
  gameTimeAnchor: 'Известный момент начала игровой дневной фазы (ISO 8601).',
  gameTimeDayMinutes: 'Длительность игрового дня в минутах.',
  gameTimeNightMinutes: 'Длительность игровой ночи в минутах.',
};
for (const schema of Object.values(schemas)) {
  for (const [name, value] of Object.entries(schema.properties ?? {})) {
    if ('$ref' in value) continue;
    schema.properties![name] = {
      ...value,
      description: value.description ?? fieldDescriptions[name],
    };
  }
}
