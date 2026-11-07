import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';
import { array, object, ref, str } from './schemas';

interface Contract {
  summary: string;
  response?: SchemaObject | ReferenceObject;
  body?: string;
  bodyType?: string;
  responseTypes?: string[];
  query?: string;
  access?: string;
  public?: boolean;
  description?: string;
  status?: number;
  errors?: number[];
}
const list = (name: string) => array(ref(name));
const member = 'Член гильдии или администратор.';
const officer = 'Офицер, глава или администратор.';
const leader = 'Глава или администратор.';
const rl = 'Назначенный РЛ этого ивента, Глава или Админ.';
const c = (
  summary: string,
  response: string | SchemaObject,
  extra: Omit<Contract, 'summary' | 'response'> = {},
): Contract => ({
  summary,
  response: typeof response === 'string' ? ref(response) : response,
  access: member,
  ...extra,
});

/** Ключи привязаны к методам контроллеров; пути и HTTP-статусы сканирует Nest. */
export const contracts: Record<string, Contract> = {
  Participation_get: c('Получить своё участие в событии', 'Participation', {
    access: 'Участник с привязанным Member.',
    errors: [404],
    description:
      'Только собственное участие. canDecline учитывает дедлайн из Setting и приглашённый состав; canAttend учитывает сроки отмены всех перекрывающих периодов. absences содержит только собственные заявки.',
  }),
  Participation_update: c('Изменить своё участие в событии', 'Ok', {
    body: 'ParticipationInput',
    access: 'Участник с привязанным Member.',
    errors: [400, 404, 409],
    description:
      'attending=false создаёт отсутствие с привязкой к ID события (сохраняется при переносе, не затрагивает одновременные события), причина необязательна (до 500 символов). attending=true требует absenceIds из подтверждённой карточки (при изменении списка — 409) и отменяет все собственные активные отсутствия, покрывающие начало события, целиком — клиент должен показать подтверждение с периодами. Дедлайн отказа — из Setting; отмена невозможна после начала любого события периода. Изменения и аудит атомарны, повторные одинаковые запросы идемпотентны.',
  }),
  Week_list: c('Получить события недели со счётчиками участников', list('WeekEvent'), {
    query: 'WeekQuery',
    errors: [400],
    description:
      'Интервал [from, to) в UTC, не более 8 суток (для недели в зоне игрока с переходом летнего времени). Отменённые исключены. invitedCount — текущий состав согласно GUILD/KP/PACK; attendingCount — этот состав за вычетом активных отсутствий на начало события. Пересечения не вычитаются дважды. GS и причины отсутствий не возвращаются.',
  }),
  Dashboard_get: c('Получить четыре виджета главной', 'Dashboard', {
    description:
      'День — по Москве; максимум 5 событий. Команда — свой пак, GS только Главе/Админу. audit=null у рядового, иначе 10 последних записей. auction=null до этапа 2.',
  }),
  App_getHealth: c('Проверить состояние API и БД', 'Health', {
    public: true,
    description: 'При недоступности БД HTTP 200 и db=down.',
  }),
  App_getGuild: c('Получить название гильдии', object({ name: str })),
  App_getCombatRoles: c('Получить названия боевых ролей', 'CombatRoles', { public: true }),
  Auth_discordLogin: {
    summary: 'Войти через Discord',
    public: true,
    status: 302,
    description: 'Открывайте адрес в браузере. Перенаправляет на Discord OAuth2.',
  },
  Auth_discordCallback: {
    summary: 'Обработать возврат Discord OAuth2',
    public: true,
    status: 302,
    description:
      'Служебный callback Passport: устанавливает сессию и перенаправляет на WEB_URL. Не вызывается вручную.',
    errors: [401],
  },
  Auth_me: c('Получить текущую сессию', 'Me', {
    access: 'Любой вошедший аккаунт, включая непривязанный Discord.',
  }),
  Auth_adminLogin: c('Войти резервным администратором', 'LoginResult', {
    public: true,
    body: 'AdminLogin',
    errors: [429],
    description:
      'Устанавливает httpOnly-cookie dkp.sid. Неверные данные: HTTP 200, ok=false. Лимит: 5 запросов за 15 минут с одного IP-адреса, включая успешные входы.',
  }),
  Auth_logout: c('Завершить сессию', 'Ok', {
    public: true,
    description: 'Удаляет сессию и cookie dkp.sid.',
  }),
  Auth_testLogin: c('Войти тестовым пользователем', 'TestLoginResult', {
    public: true,
    body: 'TestLogin',
    description:
      'Только при AUTH_TEST_MODE=true. Имя должно начинаться с test-. Неверное имя: HTTP 200, ok=false.',
    errors: [404],
  }),
  Auth_createLinkRequest: c('Подать заявку на привязку Discord', 'Ok', {
    body: 'CreateLinkRequest',
    description:
      'Создаёт или редактирует актуальную ожидающую анкету. Обязательны GS и ранее загруженные собственные скриншоты. До приёма доступа к разделам гильдии нет.',
    access: 'Вошедший Discord-аккаунт.',
    errors: [400, 409],
  }),
  Auth_listLinkRequests: c('Получить очередь заявок на привязку', list('LinkRequest'), {
    access: leader,
  }),
  Auth_approveLinkRequest: c('Подтвердить привязку Discord', 'Ok', {
    access: leader,
    errors: [404, 409],
    description:
      'Приём атомарно переносит анкету и подтверждение GS в профиль и пишет аудит. Старую неполную анкету игрок должен обновить; отклонения нет.',
  }),
  Auth_myLinkRequest: c('Получить собственную ожидающую анкету', 'MyLinkRequest', {
    access: 'Любой вошедший аккаунт. Только своя анкета; null, если её нет.',
  }),
  Auth_getLinkRequest: c('Получить профиль заявителя', 'LinkRequest', {
    access: leader,
    errors: [404],
  }),
  Screenshots_upload: c('Загрузить приватный скриншот', 'Id', {
    body: 'ScreenshotUpload',
    bodyType: 'multipart/form-data',
    access: 'Вошедший Discord-аккаунт.',
    errors: [400, 413],
    description:
      'Поле file: PNG, JPG/JPEG или WebP до 10 МБ включительно. Возвращённый id указывается в screenshotIds анкеты. Проверяется сигнатура формата.',
  }),
  Screenshots_download: c(
    'Открыть приватный скриншот',
    { type: 'string', format: 'binary' },
    {
      responseTypes: ['image/png', 'image/jpeg', 'image/webp'],
      access: 'Владелец файла, Глава или Админ.',
      errors: [404],
      description:
        'Для остальных — 404. Cache-Control: private, no-store. Прямые ссылки проверяют те же права.',
    },
  ),
  Members_roster: c('Получить состав гильдии', list('RosterMember'), {
    query: 'RosterQuery',
    errors: [400],
  }),
  Members_getOne: c('Получить участника', 'RosterMember', { errors: [404] }),
  Members_update: c('Изменить участника', 'Member', {
    access: leader,
    body: 'UpdateMember',
    errors: [400, 404, 409],
    description: 'Ник, роль и пара оружия обязательны; изменение фиксируется в аудите.',
  }),
  Members_changeRank: c('Изменить ранг участника', 'Member', {
    access: leader,
    body: 'ChangeRank',
    errors: [404, 409],
    description: 'Назначаемый ранг — MEMBER или OFFICER. Комментарий обязателен.',
  }),
  Events_list: c('Получить расписание', list('Event'), { query: 'EventsQuery' }),
  Events_getOne: c('Получить ивент', 'EventDetail', { errors: [404] }),
  Events_create: c('Создать ивент', 'Id', {
    access: officer,
    body: 'CreateEvent',
    errors: [404, 409],
    description: 'Конец позже начала. Плата ДКП фиксируется при создании.',
  }),
  Events_createSeries: c('Создать серию ивентов', 'CreatedSeries', {
    access: officer,
    body: 'CreateEventSeries',
    errors: [404, 409],
    description:
      'repeat: DAILY или WEEKLY; until — включительная граница начала последнего ивента. Первый ивент включается всегда. weekdays для WEEKLY: 0=воскресенье, 6=суббота (UTC); пустой массив означает день первого ивента. Время UTC и длительность сохраняются. До 1000 ивентов за один запрос; серию и аудит сохраняет одна транзакция.',
  }),
  Events_deleteSeries: c('Удалить серию ивентов', 'DeletedSeries', {
    access: 'Глава, Админ, Офицер или назначенный РЛ своего ивента.',
    errors: [404, 409],
    description: 'Только если все ивенты серии в статусе PLANNED.',
  }),
  Events_deleteOne: c('Удалить запланированный ивент', 'Ok', {
    access: 'Глава, Админ, Офицер или назначенный РЛ своего ивента.',
    errors: [404, 409],
  }),
  Events_update: c('Изменить ивент', 'Id', {
    access: 'Глава, Админ, Офицер или назначенный РЛ своего ивента.',
    body: 'UpdateEvent',
    errors: [404, 409],
    description:
      'Плата ДКП не редактируется. Параметры завершённых/отменённых ивентов закрыты для правки. Назначать другого РЛ могут только Глава, Админ и Офицер.',
  }),
  Events_changeStatus: c('Изменить статус ивента', 'EventStatus', {
    access: 'Глава, Админ, Офицер или назначенный РЛ своего ивента.',
    body: 'ChangeEventStatus',
    errors: [404, 409],
    description:
      'PLANNED → RUNNING/CANCELLED; RUNNING → FINISHED/CANCELLED. Запуск/завершение — Глава, Админ или назначенный РЛ; отмена также доступна Офицеру. Финальные статусы неизменяемы.',
  }),
  CheckIn_playerView: c('Получить варианты чек-ин кода', 'PlayerCheckIn', {
    access: 'Участник с привязанным Member.',
    errors: [404, 409, 429],
    description: '30 запросов в минуту. Варианты доступны в активном окне.',
  }),
  CheckIn_submit: c('Отправить выбранный чек-ин код', 'CheckInResult', {
    access: 'Участник с привязанным Member.',
    body: 'SubmitCheckIn',
    errors: [404, 409, 429],
    description: 'Одна попытка на фазу. Лимит: 10 запросов в минуту.',
  }),
  CheckIn_raidLeadView: c('Получить чек-ин код для РЛ', 'RaidLeadCheckIn', {
    access: rl,
    errors: [404, 409],
  }),
  CheckIn_startEndCodeEarly: c('Открыть финальный код досрочно', 'RaidLeadCheckIn', {
    access: rl,
    errors: [404, 409, 429],
    description: 'Без тела запроса. 5 запросов в минуту. Действие фиксируется в аудите.',
  }),
  Conduct_checklist: c('Получить чек-лист посещения', list('ChecklistRow'), { errors: [404] }),
  Conduct_setAttendance: c('Отметить посещение вручную', 'Ok', {
    access: rl,
    body: 'SetAttendance',
    errors: [404, 409],
  }),
  Conduct_manualCheckIn: c('Подтвердить чек-ин вручную', 'Ok', {
    access: rl,
    body: 'ManualCheckIn',
    errors: [404, 409],
  }),
  Conduct_manualDkp: c('Добавить ручное начисление или корректировку ДКП', 'Id', {
    access: rl,
    body: 'ManualDkp',
    errors: [404, 409],
    description:
      'Новая запись append-only журнала; существующие записи не меняются. Комментарий обязателен.',
  }),
  Absences_mine: c('Получить свои активные отсутствия', list('Absence'), {
    access: 'Участник с привязанным Member.',
  }),
  Absences_list: c('Получить активные отсутствия гильдии', list('Absence'), { access: leader }),
  Absences_forEvent: c('Получить отсутствия на момент ивента', list('EventAbsence'), {
    query: 'AbsencesQuery',
    description:
      'eventId укажите для включения отсутствий, привязанных к конкретному ивенту; отсутствие ID возвращает только календарные заявки. При отсутствии startsAt используется текущее время.',
  }),
  Absences_create: c('Оформить отсутствие', 'Id', {
    access: 'Участник с привязанным Member.',
    body: 'CreateAbsence',
    errors: [409],
    description: 'dateTo ≥ dateFrom. Действует дедлайн из настроек гильдии.',
  }),
  Absences_cancel: c('Отменить своё отсутствие', 'Ok', {
    errors: [404, 409],
    description: 'Только своё отсутствие до его начала.',
  }),
  Absences_markSeen: c('Отметить отсутствие как увиденное', 'Ok', {
    access: leader,
    errors: [404],
    description: 'Не меняет статус отсутствия; повторный вызов идемпотентен.',
  }),
  Dkp_list: c('Получить журнал ДКП', 'DkpPage', {
    query: 'DkpQuery',
    description: 'Append-only журнал, баланс вычисляется суммой записей.',
  }),
  Dkp_balances: c('Получить балансы участников', list('Balance')),
  Dkp_memberBalance: c('Получить баланс участника', 'Balance', { errors: [404] }),
  Audit_list: c('Получить журнал действий', 'AuditPage', {
    access: officer,
    query: 'AuditQuery',
    description:
      'Фильтры объединяются через И: entityType, actorMemberId либо system=true, from/to (UTC). system=true выбирает записи без actorMemberId; не сочетается с actorMemberId. action сохранён для API-клиентов. Новые записи первыми. UI использует размеры 10/50/100 и не показывает total.',
    errors: [400],
  }),
  Audit_actions: c('Получить доступные действия аудита', array(str), { access: officer }),
  Profiles_get: c('Получить профиль игрока', 'Profile', { errors: [404] }),
  Profiles_updateOwn: c('Изменить свою роль и оружие', 'Ok', {
    access: 'Только владелец профиля с привязанным Member.',
    body: 'UpdateOwnProfile',
    errors: [400, 404],
    description: 'Комментарий обязателен, изменение фиксируется в аудите.',
  }),
  Rules_get: c('Получить страницу правил', 'RulesPage', { errors: [400, 404] }),
  Rules_history: c('Получить историю версий правил', list('RulesVersionSummary'), {
    errors: [400, 404],
  }),
  Rules_version: c('Получить сохранённую версию правил', 'RulesVersion', { errors: [400, 404] }),
  Rules_update: c('Опубликовать новую версию правил', 'RulesPage', {
    access: leader,
    body: 'UpdateRules',
    errors: [400, 404, 409],
    description:
      'expectedVersion защищает от перезаписи параллельных изменений. Записывает историю и аудит.',
  }),
  Rules_restore: c('Восстановить правила из версии', 'RulesPage', {
    access: leader,
    body: 'RestoreRules',
    errors: [400, 404, 409],
    description: 'Создаёт новую версию; история сохраняется. expectedVersion обязателен.',
  }),
  Settings_getAll: c('Получить настройки системы', 'Settings'),
  Settings_update: c('Изменить настройки системы', 'Settings', {
    access: leader,
    body: 'UpdateSettings',
    errors: [400],
    description:
      'Частичное обновление известных ключей. Весь запрос проверяется реестром до записи; изменения и аудит атомарны. Неизменённые значения не создают аудит.',
  }),
  Settings_getGameTime: c('Получить настройки игрового цикла', 'GuildGameTime', { errors: [404] }),
  Settings_updateGameTime: c('Изменить настройки игрового цикла', 'GuildGameTime', {
    access: leader,
    body: 'GameTimeSettings',
    errors: [400, 404],
    description:
      'Якорь и длительности сохраняются вместе с аудитом в транзакции. Повтор тех же значений не создаёт аудит.',
  }),
  EventTypes_list: c('Получить типы ивентов', list('EventType')),
  EventTypes_create: c('Создать тип ивента', 'EventType', {
    access: officer,
    body: 'EventTypeInput',
    errors: [409],
  }),
  EventTypes_rename: c('Переименовать тип ивента', 'EventType', {
    access: officer,
    body: 'EventTypeInput',
    errors: [404, 409],
  }),
  EventTypes_remove: c('Удалить тип ивента', 'Ok', { access: officer, errors: [404] }),
};

export const extraSchemas = {
  AbsencesQuery: object({ startsAt: { type: 'string', format: 'date-time' }, eventId: str }, []),
};
