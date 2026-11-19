import { describe, expect, it } from 'vitest';
import {
  activityCsv,
  attendanceCsv,
  csvMetaLines,
  dkpCsv,
  gearScoreCsv,
  lootCsv,
  overviewItemsCsv,
} from './statistics-csv';
import type {
  ActivityReport,
  AttendanceReport,
  DkpStatisticsReport,
  GearScoreStatisticsReport,
  LootStatisticsReport,
} from './statistics-csv';

const query = { from: '2026-12-01', to: '2026-12-31' };

const attendance: AttendanceReport = {
  generatedAt: '2026-12-02T12:00:00.000Z',
  start: '2026-11-30T21:00:00.000Z',
  end: '2026-12-31T21:00:00.000Z',
  overview: {
    activeMembers: 1,
    finishedEvents: 1,
    totals: {
      checks: 1,
      events: 2,
      percentage: 25,
      excused: 1,
      noShow: 0,
      late: 0,
      leftEarly: 0,
      historyStatus: 'KNOWN',
    },
  },
  weeks: [],
  members: [
    {
      id: 'm1',
      name: 'Игрок Один',
      avatar: null,
      avatarColor: null,
      totals: {
        checks: 1,
        events: 2,
        percentage: 25,
        excused: 0,
        noShow: 1,
        late: 0,
        leftEarly: 0,
        historyStatus: 'KNOWN',
      },
    },
    {
      id: 'm2',
      name: 'Без ивентов',
      avatar: null,
      avatarColor: null,
      totals: {
        checks: 0,
        events: 0,
        percentage: null,
        excused: 0,
        noShow: 0,
        late: 0,
        leftEarly: 0,
        historyStatus: 'NO_HISTORICAL_DATA',
      },
    },
  ],
  packs: [],
  kps: [],
  top: [],
  details: [
    {
      eventId: 'e1',
      eventName: 'Ивент «Кавычки»',
      startsAt: '2026-12-05T18:00:00.000Z',
      memberId: 'm1',
      nickname: 'Игрок Один',
      packId: null,
      kpId: null,
      teamStatus: 'NO_HISTORICAL_DATA',
      membershipStatus: 'NO_HISTORICAL_DATA',
      checkinStart: 'PASSED',
      checkinEnd: null,
      status: 'LEFT_EARLY',
      checks: 1,
      events: 1,
    },
  ],
};

const activity: ActivityReport = {
  generatedAt: attendance.generatedAt,
  start: attendance.start,
  end: attendance.end,
  overview: {
    activeMembers: 1,
    totals: {
      events: 1,
      counted: 2,
      visited: 1,
      checks: 1,
      attendance: 25,
      historyStatus: 'KNOWN',
    },
  },
  weeks: [],
  byType: [
    {
      eventTypeId: 't1',
      name: 'Гильдбосс',
      totals: {
        events: 1,
        counted: 2,
        visited: 1,
        checks: 1,
        attendance: 25,
        historyStatus: 'KNOWN',
      },
    },
  ],
  byMode: [],
  peak: { byWeekday: [], byHour: [{ hour: 18, visited: 2 }] },
  members: [],
  events: [
    {
      id: 'e1',
      name: 'Вечерний гильдбосс',
      startsAt: '2026-12-05T18:00:00.000Z',
      eventTypeId: 't1',
      eventTypeName: 'Гильдбосс',
      mode: 'PVE',
      scope: 'GUILD',
      scopeName: 'Гильдия',
      invited: 4,
      counted: 2,
      visited: 1,
      checks: 1,
      attendance: 25,
      historyStatus: 'KNOWN',
    },
  ],
};

const dkp: DkpStatisticsReport = {
  generatedAt: attendance.generatedAt,
  start: attendance.start,
  end: attendance.end,
  balanceAsOf: attendance.generatedAt,
  balanceIgnoresFilters: ['eventTypeId', 'mode'],
  totals: { earned: 10, spent: -4, adjustments: -1, net: 5 },
  weeks: [],
  members: [
    {
      id: 'm1',
      nickname: 'Игрок Один',
      totals: { earned: 10, spent: -4, adjustments: -1, net: 5 },
      balance: 80,
      details: [],
    },
  ],
  packs: [],
  kps: [],
  withoutEvent: { totals: { earned: 0, spent: 0, adjustments: 0, net: 0 }, members: [] },
};

const loot: LootStatisticsReport = {
  generatedAt: attendance.generatedAt,
  start: attendance.start,
  end: attendance.end,
  dropped: {
    totals: { drops: 2, items: 1 },
    items: [
      {
        itemId: 'i1',
        itemName: 'Клинок зари',
        rarity: 'Легендарный',
        slot: null,
        isArchboss: false,
        count: 2,
        sharePct: 100,
        details: [],
      },
    ],
    withoutEvent: { totals: { drops: 0, items: 0 }, items: [] },
  },
  top: [
    {
      kind: 'ITEM',
      itemId: 'i1',
      itemName: 'Клинок зари',
      rarity: null,
      slot: null,
      isArchboss: false,
      count: 3,
      sharePct: 75,
    },
    { kind: 'REST', count: 1, sharePct: 25 },
  ],
  awarded: {
    totals: { awards: 1, spent: 150 },
    awards: [],
    members: [{ id: 'm1', nickname: 'Игрок Один', totals: { awards: 1, spent: 150 } }],
    packs: [],
    kps: [],
    withoutEvent: { totals: { awards: 0, spent: 0 }, members: [] },
  },
};

const gearScore: GearScoreStatisticsReport = {
  generatedAt: attendance.generatedAt,
  start: attendance.start,
  end: attendance.end,
  asOf: attendance.generatedAt,
  staleDays: 14,
  snapshotIgnoresFilters: ['eventTypeId', 'mode'],
  totals: { members: 1, fresh: 0, stale: 1, missing: 0, staleSharePct: 100 },
  members: [
    {
      memberId: 'm1',
      nickname: 'Игрок Один',
      packId: null,
      kpId: null,
      teamStatus: 'KNOWN',
      membershipStatus: 'NO_HISTORICAL_DATA',
      freshness: 'STALE',
      lastScreenshotAt: '2026-11-01T10:00:00.000Z',
    },
  ],
};

describe('csvMetaLines', () => {
  it('период, фильтры, часовой пояс и дата среза', () => {
    const lines = csvMetaLines(attendance, query);
    expect(lines[0]).toBe('Период: 01.12.2026–31.12.2026 (по Москве, UTC+3)');
    expect(lines[1]).toBe('Фильтры: нет');
    expect(lines[2]).toContain('Дата среза: 02.12.2026');
  });
});

describe('attendanceCsv', () => {
  it('разрез игроков: проценты, null-процент пуст, кириллица и кавычки', () => {
    const file = attendanceCsv(attendance, query, 'members');
    const lines = file.split('\r\n');
    expect(lines[6]).toBe(
      'Игрок;Учитываемые ивенты (участия);Принятые отметки;Посещаемость, %;Уважительные отсутствия;Неявки;Опоздания;Ранние уходы',
    );
    expect(lines[7]).toBe('Игрок Один;2;1;25;0;1;0;0');
    // N=0 — пустой процент, а не 0.
    expect(lines[8]).toBe('Без ивентов;0;0;;0;0;0;0');
    expect(file).toContain('Формула:');
  });

  it('детали: отметки фаз, итог и историческая команда', () => {
    const file = attendanceCsv(attendance, query, 'details');
    expect(file).toContain(
      'Игрок Один;Ивент «Кавычки»;05.12.2026 21:00;Принята;—;Ушёл раньше;;нет исторических данных',
    );
  });

  it('гильдия: одна строка сводки', () => {
    const file = attendanceCsv(attendance, query, 'guild');
    expect(file.split('\r\n')[7]).toBe('Гильдия;2;1;25;1;0;0;0');
  });
});

describe('activityCsv', () => {
  it('ивенты со всеми полями справочника', () => {
    const file = activityCsv(activity, query, 'events');
    expect(file.split('\r\n')[6]).toBe(
      '05.12.2026 21:00;Вечерний гильдбосс;Гильдбосс;PvE;Гильдия;4;2;1;1;25',
    );
  });

  it('пик по часам Москвы', () => {
    const file = activityCsv(activity, query, 'peak-hour');
    expect(file.split('\r\n')[6]).toBe('18;2');
  });
});

describe('dkpCsv', () => {
  it('игроки: знаки, баланс и предупреждение об исключении фильтров', () => {
    const file = dkpCsv(dkp, query, 'members');
    expect(file).toContain(
      '# Полный баланс на 02.12.2026 15:00: без учёта фильтра типа ивента и PvE–PvP',
    );
    expect(file.split('\r\n')[7]).toBe('Игрок Один;10;-4;-1;5;80');
  });
});

describe('lootCsv и обзор', () => {
  it('выпавшие предметы с редкостью и долей', () => {
    const file = lootCsv(loot, query, 'dropped');
    expect(file.split('\r\n')[7]).toBe('Клинок зари;Легендарный;;нет;2;100');
  });

  it('топ обзора со строкой «Остальное»', () => {
    const file = overviewItemsCsv(loot, query);
    const lines = file.split('\r\n');
    expect(lines[6]).toBe('Клинок зари;3;75');
    expect(lines[7]).toBe('Остальное;1;25');
  });
});

describe('gearScoreCsv', () => {
  it('категории без значений GS, срез и подпись исключения фильтров', () => {
    const file = gearScoreCsv(gearScore, query);
    expect(file).toContain('# Срез GS на 02.12.2026 15:00; порог 14 дн.');
    expect(file).toContain('# Тип ивента и режим не влияют на срез свежести');
    expect(file.split('\r\n')[8]).toBe(
      'Игрок Один;устаревший;01.11.2026 13:00;без пака;без КП;известна',
    );
  });
});
