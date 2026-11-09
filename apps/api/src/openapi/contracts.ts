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
  Participation_roster: c('Получить состав события', list('EventRosterMember'), {
    errors: [404],
    description: 'Приглашённые по области события и их участие; GS доступен только Главе и Админу.',
  }),
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
  App_getGuild: c(
    'Получить название гильдии',
    object({ name: str, hasCrest: { type: 'boolean' } }),
  ),
  GuildSettings_crest: c(
    'Получить герб гильдии',
    { type: 'string', format: 'binary' },
    { errors: [404], description: 'PNG или WebP; доступен участникам гильдии.' },
  ),
  GuildSettings_update: c(
    'Сохранить название и герб гильдии',
    object({ name: str, hasCrest: { type: 'boolean' } }),
    {
      body: 'GuildSettingsInput',
      bodyType: 'multipart/form-data',
      access: leader,
      errors: [400, 403, 404],
      description:
        'Название от 1 до 80 символов; необязательный PNG/WebP с прозрачностью, до 2 МБ и 1024×1024.',
    },
  ),
  App_getCombatRoles: c('Получить названия боевых ролей', 'CombatRoles', { public: true }),
  Auth_providers: c(
    'Проверить доступность входа через Discord',
    object({ discord: { type: 'boolean' } }),
    {
      public: true,
      description:
        'Возвращает только доступность OAuth без Client ID, секретов и callback. Пустая или частичная конфигурация отключает Discord, резервный вход администратора остаётся доступен.',
    },
  ),
  Auth_discordLogin: {
    summary: 'Войти через Discord',
    public: true,
    status: 302,
    description:
      'Открывайте адрес в браузере. Перенаправляет на Discord OAuth2. Если Discord не настроен, возвращает 503.',
    errors: [503],
  },
  Auth_discordCallback: {
    summary: 'Обработать возврат Discord OAuth2',
    public: true,
    status: 302,
    description:
      'Служебный callback Passport: устанавливает сессию и перенаправляет на WEB_URL. Не вызывается вручную.',
    errors: [401, 503],
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
    description:
      'Одна попытка на фазу. Проверка, отметка, начисление и аудит атомарны; одновременные попытки не удваивают ДКП. Лимит: 10 запросов в минуту.',
  }),
  CheckIn_raidLeadView: c('Получить чек-ин код для РЛ', 'RaidLeadCheckIn', {
    access: rl,
    errors: [404, 409],
  }),
  CheckIn_startEndCodeEarly: c('Открыть финальный код досрочно', 'RaidLeadCheckIn', {
    access: rl,
    errors: [404, 409, 429],
    description:
      'Без тела запроса. 5 запросов в минуту. Код и факт запуска в аудите создаются атомарно, сам код не журналируется.',
  }),
  Conduct_applySummary: c('Применить подготовленные итоги ивента', 'EventSummaryApplied', {
    access: rl,
    body: 'ApplyEventSummary',
    errors: [400, 404, 409],
    description:
      'CHECKIN, EXCUSE, DKP и ATTENDANCE применяются одной serializable-транзакцией с аудитом. EXCUSE оформляет отсутствие на конкретный ивент с обязательной причиной, в том числе после завершения. Плата за ручной код берётся из Setting. Существующие ledger-записи не меняются. Отменённый ивент доступен только для чтения, включая повторное получение ранее выданной квитанции. requestId — UUID; точный повтор тем же автором возвращает repeated=true без повторных начислений. При неизвестном результате повторять тот же requestId и payload; изменение payload/автора/ивента под тем же ID даёт 409. Не более 1000 действий за запрос (технический предел). Участники проверяются по текущему составу GUILD/KP/PACK.',
  }),
  Conduct_checklist: c('Получить чек-лист посещения', list('ChecklistRow'), {
    errors: [404],
    description:
      'Текущий состав согласно GUILD/KP/PACK, без GS. automaticStatus вычисляется по PASSED/MANUAL кодам и оформленным отсутствиям; attendanceStatus учитывает ранее сохранённый ручной статус, statusIsManual отличает его от автоматического. Уважительная без кодов не приносит очков. dkpEarned — сумма существующих записей ledger, а не расчёт по статусу.',
  }),
  Conduct_setAttendance: c('Отметить посещение вручную', 'Ok', {
    access: rl,
    body: 'SetAttendance',
    description: 'Отметка и аудит записываются одной транзакцией.',
    errors: [404, 409],
  }),
  Conduct_manualCheckIn: c('Подтвердить чек-ин вручную', 'Ok', {
    access: rl,
    body: 'ManualCheckIn',
    description:
      'Отметка, доля ДКП из Setting и аудит атомарны. Повтор уже принятой фазы даёт 409, включая гонку с самостоятельным чек-ином.',
    errors: [404, 409],
  }),
  Conduct_manualDkp: c('Добавить ручное начисление или корректировку ДКП', 'Id', {
    access: rl,
    body: 'ManualDkp',
    errors: [404, 409],
    description:
      'Новая запись append-only журнала и аудит сохраняются атомарно; существующие записи не меняются. Комментарий обязателен.',
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
    description:
      'dateTo > dateFrom; интервал полуоткрытый. События, чей дедлайн на момент подачи истёк, не покрываются.',
  }),
  Absences_cancel: c('Отменить своё отсутствие', 'Ok', {
    errors: [404, 409],
    description: 'Только своё отсутствие до его начала.',
  }),
  Absences_markSeen: c('Отметить отсутствие как увиденное', 'Ok', {
    access: leader,
    errors: [404],
    description:
      'Не меняет статус отсутствия. Отметка и аудит атомарны; повторные/одновременные запросы идемпотентны. Доступно также резервному админу без Member. seenBy в обоих списках содержит ID участников и system-admin для резервного администратора.',
  }),
  Dkp_list: c('Получить журнал ДКП', 'DkpPage', {
    query: 'DkpQuery',
    description: 'Append-only журнал, баланс вычисляется суммой записей.',
  }),
  Dkp_balances: c('Получить балансы участников', list('Balance')),
  Dkp_grant: c('Начислить ДКП участнику', object({ id: str, repeated: { type: 'boolean' } }), {
    body: 'AdminDkpGrant',
    access: 'Только резервный Админ.',
    errors: [400, 403, 404, 409],
    description: 'Положительное начисление и аудит создаются атомарно; requestId защищает повтор.',
  }),
  Dkp_memberBalance: c('Получить баланс участника', 'Balance', { errors: [404] }),
  Audit_list: c('Получить журнал действий', 'AuditPage', {
    access: 'Офицер, Глава и Админ — полный журнал; участник — личные записи.',
    query: 'AuditQuery',
    description:
      'Личная область выбирается до фильтров и пагинации; групповые детали скрыты. Фильтры объединяются через И. system=true исключает отмеченные действия Админа. Новые записи первыми.',
    errors: [400],
  }),
  Audit_actions: c('Получить доступные действия аудита', array(str)),
  Profiles_get: c('Получить профиль игрока', 'Profile', { errors: [404] }),
  Profiles_updateOwn: c('Изменить свою роль и оружие', 'Ok', {
    access: 'Только владелец профиля с привязанным Member.',
    body: 'UpdateOwnProfile',
    errors: [400, 404],
    description:
      'Комментарий обязателен при изменении роли или оружия; при смене только своего аватара он необязателен. Изменение фиксируется в аудите.',
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
  Items_list: c('Получить справочник предметов', list('Item'), {
    description: 'Справочник предметов аукциона (план 2.4): читают все члены гильдии.',
  }),
  Items_create: c('Создать предмет', 'Item', {
    access: officer,
    body: 'ItemInput',
    errors: [400, 409],
    description: 'Изменение пишется в аудит (план 2.9).',
  }),
  Items_update: c('Изменить предмет', 'Item', {
    access: officer,
    body: 'ItemInput',
    errors: [400, 404, 409],
  }),
  Items_remove: c('Удалить предмет', 'Ok', {
    access: officer,
    errors: [404, 409],
    description:
      'Предмет, использованный хотя бы в одном лоте, не удаляется (409) — история лотов сохраняется.',
  }),
  Loot_list: c('Получить дроп и лоты ивента', list('LootDrop'), {
    access: rl,
    errors: [403, 404],
    description:
      'Просмотр управляющим ивента на любом статусе, включая отменённый (план 2.6). Связанные лоты продолжают торги независимо от статуса ивента.',
  }),
  Loot_defaults: c('Получить начальные значения лота по предмету', 'LotDefaults', {
    access: rl,
    errors: [404],
    description:
      'Стартовая цена — рекомендованная цена справочника (иначе 0), остальные значения — из настроек аукциона (план 6, п. 1).',
  }),
  Loot_createDrop: c('Зафиксировать дроп на ивенте', 'LootDrop', {
    access: rl,
    body: 'CreateDrop',
    errors: [400, 403, 404, 409],
    description:
      'Фиксация выпавшего предмета из справочника с привязкой к ивенту; пишется в аудит. Доступно на запланированном или идущем ивенте (2.6).',
  }),
  Loot_createLot: c('Создать открытый лот по дропу', 'AuctionLot', {
    access: rl,
    body: 'CreateLot',
    errors: [400, 403, 404, 409],
    description:
      'Живая раздача (FIRST_BID): таймер торгов запускается от первой ставки (endsAt=null до неё), без ставок лот закрывается по noBidTimeoutSec. Длинный лот (OPENING): отсчёт от открытия, endsAt = создание + длительность. Длительность задаётся значением и единицей (минуты/дни): живая раздача 30–600 сек, длинный лот до 14 дней. Наценка и разметка предмета фиксируются на лоте (план 6, п. 6). Повторный лот по тому же дропу — 409.',
  }),
  Bids_list: c('Получить открытую историю ставок лота', list('Bid'), {
    errors: [404],
    description:
      'Ставки видны всем членам гильдии (план 6: открытый аукцион). Порядок — по времени.',
  }),
  Bids_place: c('Сделать ставку', 'PlaceBidResult', {
    body: 'PlaceBid',
    errors: [400, 403, 404, 409],
    description:
      'Первая ставка — не ниже стартовой цены, следующие — не ниже текущей плюс шаг; принимаются только на действующий лот в пределах серверного времени. Полная стоимость с наценкой (округление вверх) вместе с замороженными суммами по другим лотам не может превышать баланс журнала ДКП. Живая раздача запускает торговый таймер от первой ставки; ставка в окне анти-снайпа (включая точную границу) прибавляет продление к окончанию. Проверки атомарны (serializable), отклонённая ставка не оставляет побочных эффектов; принятая пишется в аудит.',
  }),
};

export const extraSchemas = {
  GuildSettingsInput: object({ name: str, file: { type: 'string', format: 'binary' } }, ['name']),
  AbsencesQuery: object(
    {
      startsAt: { type: 'string', format: 'date-time' },
      endsAt: { type: 'string', format: 'date-time' },
      eventId: str,
    },
    [],
  ),
};
