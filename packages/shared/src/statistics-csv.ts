import { csvFiltersLabel, csvMoscowDate, csvMoscowDateTime, csvPercent, toCsvFile } from './csv';
import type {
  ActivityReport,
  AttendanceReport,
  DkpStatisticsReport,
  GearScoreStatisticsReport,
  LootStatisticsReport,
  StatisticsQuery,
} from './index';

/**
 * CSV-выгрузки всех таблиц статистики (#223, план 2.8). Чистая сериализация
 * готовых серверных отчётов (#212–#217) без повторения расчётов: строки
 * и суммы совпадают с выборкой целиком, а не с видимой страницей. Русские
 * заголовки; мета-строки несут период, фильтры, часовой пояс и дату среза;
 * предупреждения об исключениях полного баланса и «Без ивента» сохраняются.
 */

const ATTENDANCE_STATUS_CSV: Record<string, string> = {
  PRESENT: 'Участвовал',
  LATE: 'Опоздал',
  LEFT_EARLY: 'Ушёл раньше',
  NO_SHOW: 'Отсутствовал',
  EXCUSED_ABSENCE: 'Отсутствовал по ув. причине',
};
const CHECKIN_CSV: Record<string, string> = {
  PENDING: '—',
  ACTIVE: 'Вводит',
  PASSED: 'Принята',
  FAILED: 'Ошибка',
  EXPIRED: 'Не успел',
  MANUAL: 'Ручная отметка',
};
const DKP_TYPE_CSV: Record<string, string> = {
  CHECKIN_EARN: 'Чек-ин',
  RAID_LEAD_BONUS: 'За ведение рейда',
  WEEKLY_DECAY: 'Еженедельное сгорание',
  MANUAL_EARN: 'Ручное начисление',
  AUCTION_SPEND: 'Покупка на аукционе',
  ADJUSTMENT: 'Корректировка',
};
const LOT_STATUS_CSV: Record<string, string> = {
  OPEN: 'Лот ещё разыгрывается',
  CLOSED: 'Лот закрыт',
  CANCELLED: 'Лот отменён',
};
const HISTORY_CSV: Record<string, string> = {
  KNOWN: 'известна',
  NO_HISTORICAL_DATA: 'нет исторических данных',
};

/** Общие мета-строки всех выгрузок: период, фильтры, часовой пояс, срез. */
export function csvMetaLines(
  report: { generatedAt: string; start: string; end: string },
  query: StatisticsQuery,
  extra: string[] = [],
): string[] {
  return [
    `Период: ${csvMoscowDate(report.start)}–${csvMoscowDate(new Date(Date.parse(report.end) - 1).toISOString())} (по Москве, UTC+3)`,
    `Фильтры: ${csvFiltersLabel(query)}`,
    `Дата среза: ${csvMoscowDateTime(report.generatedAt)}`,
    ...extra,
  ];
}

function historyRow(teamStatus: string): string {
  return HISTORY_CSV[teamStatus] ?? teamStatus;
}

// ——— Посещаемость (#213) ———

export type AttendanceCsvCut = 'members' | 'packs' | 'kps' | 'guild' | 'details';

export function attendanceCsv(
  report: AttendanceReport,
  query: StatisticsQuery,
  cut: AttendanceCsvCut,
): string {
  const meta = csvMetaLines(report, query, [
    'Формула: (принятые отметки / 2) / учитываемые ивенты × 100%; уважительные отсутствия исключены из знаменателя',
    'Пустой процент — нет ивентов для расчёта',
  ]);
  if (cut === 'details') {
    return toCsvFile(
      meta,
      [
        'Игрок',
        'Ивент',
        'Дата ивента',
        'Отметка «старт»',
        'Отметка «финал»',
        'Итог',
        'Команда на момент ивента',
        'История участия',
      ],
      report.details.map((row) => [
        row.nickname,
        row.eventName || row.eventId,
        csvMoscowDateTime(row.startsAt),
        CHECKIN_CSV[row.checkinStart ?? 'PENDING'] ?? row.checkinStart ?? '—',
        CHECKIN_CSV[row.checkinEnd ?? 'PENDING'] ?? row.checkinEnd ?? '—',
        ATTENDANCE_STATUS_CSV[row.status] ?? row.status,
        row.packId || row.kpId ? `${row.packId ?? 'без пака'} / ${row.kpId ?? 'без КП'}` : '',
        historyRow(row.teamStatus),
      ]),
    );
  }
  const rows =
    cut === 'guild'
      ? [
          {
            id: null,
            name: 'Гильдия',
            avatar: null,
            avatarColor: null,
            totals: report.overview.totals,
          },
        ]
      : cut === 'members'
        ? report.members
        : cut === 'packs'
          ? report.packs
          : report.kps;
  return toCsvFile(
    meta,
    [
      cut === 'members' ? 'Игрок' : 'Команда',
      'Учитываемые ивенты (участия)',
      'Принятые отметки',
      'Посещаемость, %',
      'Уважительные отсутствия',
      'Неявки',
      'Опоздания',
      'Ранние уходы',
    ],
    rows.map((row) => [
      row.name ?? (row.id === null ? 'Нет исторических данных' : row.id),
      row.totals.events,
      row.totals.checks,
      csvPercent(row.totals.percentage),
      row.totals.excused,
      row.totals.noShow,
      row.totals.late,
      row.totals.leftEarly,
    ]),
  );
}

// ——— Активность (#214) ———

export type ActivityCsvTable =
  | 'types'
  | 'modes'
  | 'weeks'
  | 'peak-weekday'
  | 'peak-hour'
  | 'members'
  | 'member-details'
  | 'events';

export function activityCsv(
  report: ActivityReport,
  query: StatisticsQuery,
  table: ActivityCsvTable,
): string {
  const meta = csvMetaLines(report, query, [
    'Одна принятая отметка — одно посещённое событие; процент сохраняет половины',
  ]);
  if (table === 'types' || table === 'modes' || table === 'weeks') {
    const rows =
      table === 'types'
        ? report.byType.map((row) => [row.name, row.eventTypeId])
        : table === 'modes'
          ? report.byMode.map((row) => [row.mode === 'PVE' ? 'PvE' : 'PvP', ''])
          : report.weeks.map((row) => [
              `${csvMoscowDate(row.start)}–${csvMoscowDate(new Date(Date.parse(row.end) - 1).toISOString())}`,
              '',
            ]);
    const totals =
      table === 'types'
        ? report.byType.map((row) => row.totals)
        : table === 'modes'
          ? report.byMode.map((row) => row.totals)
          : report.weeks.map((row) => row.totals);
    return toCsvFile(
      meta,
      [
        table === 'types' ? 'Тип ивента' : table === 'modes' ? 'Режим' : 'Неделя',
        'Идентификатор',
        'Завершено ивентов',
        'Участия',
        'Посещено',
        'Отметки',
        'Посещаемость, %',
      ],
      rows.map((row, index) => [
        row[0]!,
        row[1] ?? '',
        totals[index]!.events,
        totals[index]!.counted,
        totals[index]!.visited,
        totals[index]!.checks,
        csvPercent(totals[index]!.attendance),
      ]),
    );
  }
  if (table === 'peak-weekday' || table === 'peak-hour') {
    const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return toCsvFile(
      meta,
      [
        table === 'peak-weekday' ? 'День недели (Москва)' : 'Час начала (Москва)',
        'Посещено участий',
      ],
      table === 'peak-weekday'
        ? report.peak.byWeekday.map((row) => [
            names[row.weekday] ?? String(row.weekday),
            row.visited,
          ])
        : report.peak.byHour.map((row) => [String(row.hour), row.visited]),
    );
  }
  if (table === 'members') {
    return toCsvFile(
      meta,
      ['Игрок', 'Посещено ивентов', 'Участия', 'Отметки', 'По типам'],
      report.members.map((row) => [
        row.nickname,
        row.totals.visited,
        row.totals.counted,
        row.totals.checks,
        row.byType.map((type) => `${type.name}: ${type.totals.visited}`).join('; '),
      ]),
    );
  }
  if (table === 'member-details') {
    return toCsvFile(
      meta,
      [
        'Игрок',
        'Ивент',
        'Дата ивента',
        'Тип',
        'Режим',
        'Итог',
        'Отметки',
        'Команда на момент ивента',
        'История участия',
      ],
      report.members.flatMap((member) =>
        member.details.map((row) => [
          member.nickname,
          row.eventName || row.eventId,
          csvMoscowDateTime(row.startsAt),
          row.eventTypeName,
          row.mode === 'PVE' ? 'PvE' : 'PvP',
          ATTENDANCE_STATUS_CSV[row.status] ?? row.status,
          row.checks,
          row.packId || row.kpId ? `${row.packId ?? 'без пака'} / ${row.kpId ?? 'без КП'}` : '',
          historyRow(row.teamStatus),
        ]),
      ),
    );
  }
  return toCsvFile(
    meta,
    [
      'Дата',
      'Название',
      'Тип',
      'Режим',
      'Область приглашения',
      'Приглашено',
      'Учитывалось',
      'Посещено',
      'Отметки',
      'Посещаемость, %',
    ],
    report.events.map((row) => [
      csvMoscowDateTime(row.startsAt),
      row.name || row.eventTypeName,
      row.eventTypeName,
      row.mode === 'PVE' ? 'PvE' : 'PvP',
      row.scopeName,
      row.invited,
      row.counted,
      row.visited,
      row.checks,
      csvPercent(row.attendance),
    ]),
  );
}

// ——— ДКП (#215) ———

export type DkpCsvTable =
  'weeks' | 'members' | 'packs' | 'kps' | 'movements' | 'without-event' | 'without-event-movements';

type CsvCell = string | number | null | undefined;

function movementRows(
  movements: DkpStatisticsReport['members'][number]['details'],
  withPlayer: boolean,
): CsvCell[][] {
  return movements.map((row) => [
    ...(withPlayer ? [row.nickname] : []),
    DKP_TYPE_CSV[row.type] ?? row.type,
    csvMoscowDateTime(row.occurredAt),
    row.amount,
    row.eventName ?? '',
    row.eventTypeName ?? '',
    row.mode === null ? '' : row.mode === 'PVE' ? 'PvE' : 'PvP',
    row.auctionItemName ?? row.auctionId ?? '',
    row.packId ?? 'без пака',
    row.kpId ?? 'без КП',
    historyRow(row.teamStatus),
  ]);
}

export function dkpCsv(
  report: DkpStatisticsReport,
  query: StatisticsQuery,
  table: DkpCsvTable,
): string {
  const ignored = report.balanceIgnoresFilters.map((key) =>
    key === 'eventTypeId' ? 'типа ивента' : 'PvE–PvP',
  );
  const meta = csvMetaLines(report, query, [
    'Начисления — чек-ин и ручные; корректировки отдельно со знаком, заработком не являются',
    `Полный баланс на ${csvMoscowDateTime(report.balanceAsOf)}: без учёта фильтра ${ignored.join(' и ') || 'типа ивента'}`,
  ]);
  if (table === 'weeks') {
    return toCsvFile(
      meta,
      ['Неделя', 'Начислено', 'Потрачено', 'Корректировки', 'Итого'],
      report.weeks.map((row) => [
        `${csvMoscowDate(row.start)}–${csvMoscowDate(new Date(Date.parse(row.end) - 1).toISOString())}`,
        row.totals.earned,
        row.totals.spent,
        row.totals.adjustments,
        row.totals.net,
      ]),
    );
  }
  if (table === 'members' || table === 'packs' || table === 'kps') {
    const rows =
      table === 'members' ? report.members : table === 'packs' ? report.packs : report.kps;
    return toCsvFile(
      meta,
      [
        table === 'members' ? 'Игрок' : 'Команда',
        'Начислено',
        'Потрачено',
        'Корректировки',
        'Итого',
        ...(table === 'members' ? [`Баланс на ${csvMoscowDateTime(report.balanceAsOf)}`] : []),
      ],
      rows.map((row) => [
        'nickname' in row
          ? row.nickname
          : (row.name ?? (row.id === null ? 'Нет исторических данных' : row.id)),
        row.totals.earned,
        row.totals.spent,
        row.totals.adjustments,
        row.totals.net,
        ...('balance' in row ? [row.balance] : []),
      ]),
    );
  }
  if (table === 'movements') {
    return toCsvFile(
      meta,
      [
        'Игрок',
        'Тип операции',
        'Дата',
        'Сумма',
        'Связанный ивент',
        'Тип ивента',
        'Режим',
        'Лот',
        'Пак',
        'КП',
        'История команды',
      ],
      report.members.flatMap((member) => movementRows(member.details, true)),
    );
  }
  if (table === 'without-event') {
    const showDecay = !!report.withoutEvent.totals.decayed;
    return toCsvFile(
      meta,
      [
        'Игрок',
        'Начислено',
        'Потрачено',
        'Корректировки',
        ...(showDecay ? ['Сгорело'] : []),
        'Итого',
      ],
      report.withoutEvent.members.map((row) => [
        row.nickname,
        row.totals.earned,
        row.totals.spent,
        row.totals.adjustments,
        ...(showDecay ? [row.totals.decayed ?? 0] : []),
        row.totals.net,
      ]),
    );
  }
  return toCsvFile(
    meta,
    [
      'Игрок',
      'Тип операции',
      'Дата',
      'Сумма',
      'Связанный ивент',
      'Тип ивента',
      'Режим',
      'Лот',
      'Пак',
      'КП',
      'История команды',
    ],
    report.withoutEvent.members.flatMap((member) => movementRows(member.details, true)),
  );
}

// ——— Лут (#216) ———

export type LootCsvTable =
  | 'dropped'
  | 'dropped-details'
  | 'awarded'
  | 'awarded-members'
  | 'awarded-packs'
  | 'awarded-kps'
  | 'without-event-dropped'
  | 'without-event-awarded';

export function lootCsv(
  report: LootStatisticsReport,
  query: StatisticsQuery,
  table: LootCsvTable,
): string {
  const meta = csvMetaLines(report, query, [
    'Выпадение и получение — разные факты с разными датами; нераспределённый дроп не является выдачей',
    'Цена — фактическое списание журнала, текущие наценки и скидки её не пересчитывают',
  ]);
  if (table === 'dropped' || table === 'without-event-dropped') {
    const items = table === 'dropped' ? report.dropped.items : report.dropped.withoutEvent.items;
    return toCsvFile(
      meta,
      ['Предмет', 'Редкость', 'Слот', 'Архибосс', 'Количество', 'Доля выпадений, %'],
      items.map((row) => [
        row.itemName,
        row.rarity ?? '',
        row.slot ?? '',
        row.isArchboss ? 'да' : 'нет',
        row.count,
        row.sharePct,
      ]),
    );
  }
  if (table === 'dropped-details') {
    return toCsvFile(
      meta,
      ['Предмет', 'Дата выпадения', 'Ивент', 'Пак', 'КП', 'История команды', 'Лот', 'Статус лота'],
      report.dropped.items.flatMap((item) =>
        item.details.map((row) => [
          item.itemName,
          csvMoscowDateTime(row.occurredAt),
          row.eventName ?? 'без ивента (хранилище)',
          row.packId ?? 'без пака',
          row.kpId ?? 'без КП',
          historyRow(row.teamStatus),
          row.lotId ?? 'не выставлялся',
          row.lotStatus ? (LOT_STATUS_CSV[row.lotStatus] ?? row.lotStatus) : '',
        ]),
      ),
    );
  }
  if (table === 'awarded') {
    return toCsvFile(
      meta,
      [
        'Получатель',
        'Предмет',
        'Ивент',
        'Лот',
        'Дата получения',
        'Фактическая цена, ДКП',
        'Наценка, %',
        'Скидка, %',
      ],
      report.awarded.awards.map((row) => [
        row.nickname,
        row.itemName,
        row.eventName ?? 'без ивента (хранилище)',
        row.auctionId,
        csvMoscowDateTime(row.occurredAt),
        row.finalPrice,
        row.markupPct,
        row.discountPct,
      ]),
    );
  }
  if (table === 'awarded-members' || table === 'awarded-packs' || table === 'awarded-kps') {
    const rows =
      table === 'awarded-members'
        ? report.awarded.members
        : table === 'awarded-packs'
          ? report.awarded.packs
          : report.awarded.kps;
    return toCsvFile(
      meta,
      [
        table === 'awarded-members' ? 'Получатель' : 'Команда',
        'Предметов',
        'Сумма фактических цен, ДКП',
      ],
      rows.map((row) => [
        'nickname' in row
          ? row.nickname
          : (row.name ?? (row.id === null ? 'Нет исторических данных' : row.id)),
        row.totals.awards,
        row.totals.spent,
      ]),
    );
  }
  return toCsvFile(
    meta,
    ['Получатель', 'Предметов', 'Сумма фактических цен, ДКП'],
    report.awarded.withoutEvent.members.map((row) => [
      row.nickname,
      row.totals.awards,
      row.totals.spent,
    ]),
  );
}

// ——— Обзор: рейтинги/типы/предметы (#213–#216) и свежесть GS (#217) ———

export type OverviewCsvTable = 'top' | 'types' | 'items' | 'gear-score';

export function overviewTopCsv(report: AttendanceReport, query: StatisticsQuery): string {
  return attendanceCsv({ ...report, members: report.top }, query, 'members');
}

export function overviewItemsCsv(report: LootStatisticsReport, query: StatisticsQuery): string {
  const meta = csvMetaLines(report, query, [
    'Знаменатель долей — все выпадения выборки; остаток за пределами топа — строка «Остальное»',
  ]);
  return toCsvFile(
    meta,
    ['Предмет', 'Количество', 'Доля выпадений, %'],
    report.top.map((row) =>
      row.kind === 'ITEM'
        ? [row.itemName, row.count, row.sharePct]
        : ['Остальное', row.count, row.sharePct],
    ),
  );
}

export function gearScoreCsv(report: GearScoreStatisticsReport, query: StatisticsQuery): string {
  const freshness: Record<string, string> = {
    FRESH: 'актуальный',
    STALE: 'устаревший',
    MISSING: 'нет скриншота',
  };
  const meta = csvMetaLines(
    { generatedAt: report.generatedAt, start: report.start, end: report.end },
    query,
    [
      `Срез GS на ${csvMoscowDateTime(report.asOf)}; порог ${report.staleDays} дн.`,
      'Тип ивента и режим не влияют на срез свежести',
      'Доступно только Главе и Админу; значений GS в выгрузке нет',
    ],
  );
  return toCsvFile(
    meta,
    ['Участник', 'Свежесть', 'Последний скриншот', 'Пак', 'КП', 'История команды'],
    report.members.map((row) => [
      row.nickname,
      freshness[row.freshness] ?? row.freshness,
      row.lastScreenshotAt ? csvMoscowDateTime(row.lastScreenshotAt) : '',
      row.packId ?? 'без пака',
      row.kpId ?? 'без КП',
      historyRow(row.teamStatus),
    ]),
  );
}
