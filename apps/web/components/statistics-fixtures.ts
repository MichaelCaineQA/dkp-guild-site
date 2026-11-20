import type {
  ActivityReport,
  AttendanceReport,
  DkpStatisticsReport,
  GearScoreStatisticsReport,
  LootStatisticsReport,
  StatisticsReport,
} from '@dkp/shared';

/**
 * Фикстуры отчётов статистики для компонентных тестов вкладок (#219–#222).
 * Даты — декабрь 2026 по Москве; значения согласованы между отчётами
 * (карточки обзора сходятся с недельными графиками и топом).
 */

export const PERIOD = {
  from: '2026-12-01',
  to: '2026-12-31',
  start: '2026-11-30T21:00:00.000Z',
  end: '2026-12-31T21:00:00.000Z',
  generatedAt: '2026-12-02T12:00:00.000Z',
};

export function attendanceTotalsFixture(
  overrides: Partial<{
    checks: number;
    events: number;
    percentage: number | null;
    excused: number;
    noShow: number;
    late: number;
    leftEarly: number;
  }> = {},
) {
  const checks = overrides.checks ?? 12;
  const events = overrides.events ?? 8;
  return {
    checks,
    events,
    percentage:
      overrides.percentage !== undefined ? overrides.percentage : attendancePct(checks, events),
    excused: overrides.excused ?? 1,
    noShow: overrides.noShow ?? 2,
    late: overrides.late ?? 0,
    leftEarly: overrides.leftEarly ?? 0,
    historyStatus: 'KNOWN' as const,
  };
}

function attendancePct(checks: number, events: number): number | null {
  return events === 0 ? null : (checks / (2 * events)) * 100;
}

export function attendanceReportFixture(
  overrides: Partial<AttendanceReport> = {},
): AttendanceReport {
  const week = {
    start: '2026-11-30T21:00:00.000Z',
    end: '2026-12-07T21:00:00.000Z',
    // Разные ивенты недели сходятся с overview.finishedEvents (#251).
    finishedEvents: 2,
    totals: attendanceTotalsFixture({ checks: 8, events: 5, excused: 0, noShow: 1 }),
  };
  const topMember = {
    id: 'm1',
    name: 'Игрок Один',
    avatar: 'DRAGON',
    avatarColor: 'GREEN',
    totals: attendanceTotalsFixture({ checks: 6, events: 3, excused: 0, noShow: 0 }),
  };
  return {
    generatedAt: PERIOD.generatedAt,
    start: PERIOD.start,
    end: PERIOD.end,
    overview: {
      activeMembers: 3,
      finishedEvents: 2,
      totals: attendanceTotalsFixture(),
    },
    weeks: [week],
    members: [
      topMember,
      {
        id: 'm2',
        name: 'Игрок Два',
        avatar: null,
        avatarColor: null,
        totals: attendanceTotalsFixture({ checks: 4, events: 5, excused: 1, noShow: 1 }),
      },
    ],
    packs: [
      {
        id: 'p1',
        name: 'Пак Один',
        avatar: null,
        avatarColor: null,
        totals: attendanceTotalsFixture(),
      },
    ],
    kps: [
      {
        id: 'kp1',
        name: 'КП Альфа',
        avatar: null,
        avatarColor: null,
        totals: attendanceTotalsFixture(),
      },
    ],
    top: [topMember],
    details: [],
    ...overrides,
  };
}

export function activityTotalsFixture(
  overrides: Partial<{
    events: number;
    counted: number;
    visited: number;
    checks: number;
    attendance: number | null;
  }> = {},
) {
  const counted = overrides.counted ?? 8;
  const checks = overrides.checks ?? 12;
  return {
    events: overrides.events ?? 2,
    counted,
    visited: overrides.visited ?? 3,
    checks,
    attendance:
      overrides.attendance !== undefined ? overrides.attendance : attendancePct(checks, counted),
    historyStatus: 'KNOWN' as const,
  };
}

export function activityReportFixture(overrides: Partial<ActivityReport> = {}): ActivityReport {
  return {
    generatedAt: PERIOD.generatedAt,
    start: PERIOD.start,
    end: PERIOD.end,
    overview: { activeMembers: 3, totals: activityTotalsFixture() },
    weeks: [
      {
        start: '2026-11-30T21:00:00.000Z',
        end: '2026-12-07T21:00:00.000Z',
        totals: activityTotalsFixture({ events: 1, counted: 5, visited: 2, checks: 8 }),
      },
    ],
    byType: [{ eventTypeId: 't1', name: 'Гильдбосс', totals: activityTotalsFixture() }],
    byMode: [
      { mode: 'PVE', totals: activityTotalsFixture() },
      {
        mode: 'PVP',
        totals: activityTotalsFixture({ events: 0, counted: 0, visited: 0, checks: 0 }),
      },
    ],
    peak: {
      byWeekday: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        visited: weekday === 5 ? 2 : 0,
      })),
      byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, visited: hour === 18 ? 2 : 0 })),
    },
    members: [
      {
        id: 'm1',
        nickname: 'Игрок Один',
        totals: activityTotalsFixture({ events: 2, counted: 3, visited: 2, checks: 6 }),
        byType: [
          {
            eventTypeId: 't1',
            name: 'Гильдбосс',
            totals: activityTotalsFixture({ events: 2, counted: 3, visited: 2, checks: 6 }),
          },
        ],
        details: [
          {
            eventId: 'e1',
            eventName: 'Вечерний гильдбосс',
            startsAt: '2026-12-05T18:00:00.000Z',
            eventTypeId: 't1',
            eventTypeName: 'Гильдбосс',
            mode: 'PVE',
            packId: 'p1',
            kpId: 'kp1',
            teamStatus: 'KNOWN',
            status: 'PRESENT',
            checks: 2,
            visited: true,
          },
        ],
      },
    ],
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
        counted: 4,
        visited: 3,
        checks: 5,
        attendance: attendancePct(5, 4),
        historyStatus: 'KNOWN',
      },
    ],
    ...overrides,
  };
}

export function dkpTotalsFixture(
  overrides: Partial<{
    earned: number;
    spent: number;
    adjustments: number;
  }> = {},
) {
  const earned = overrides.earned ?? 120;
  const spent = overrides.spent ?? -40;
  const adjustments = overrides.adjustments ?? -5;
  return { earned, spent, adjustments, net: earned + spent + adjustments };
}

export function dkpReportFixture(
  overrides: Partial<DkpStatisticsReport> = {},
): DkpStatisticsReport {
  const movement = {
    id: 'd1',
    memberId: 'm1',
    nickname: 'Игрок Один',
    type: 'CHECKIN_EARN' as const,
    amount: 10,
    occurredAt: PERIOD.generatedAt,
    comment: null,
    eventId: 'e1',
    eventName: 'Вечерний гильдбосс',
    startsAt: '2026-12-05T18:00:00.000Z',
    eventTypeId: 't1',
    eventTypeName: 'Гильдбосс',
    mode: 'PVE' as const,
    auctionId: null,
    auctionItemName: null,
    packId: 'p1',
    kpId: 'kp1',
    teamStatus: 'KNOWN' as const,
  };
  return {
    generatedAt: PERIOD.generatedAt,
    start: PERIOD.start,
    end: PERIOD.end,
    balanceAsOf: PERIOD.generatedAt,
    balanceIgnoresFilters: ['eventTypeId', 'mode'],
    totals: dkpTotalsFixture(),
    weeks: [
      {
        start: '2026-11-30T21:00:00.000Z',
        end: '2026-12-07T21:00:00.000Z',
        totals: dkpTotalsFixture(),
      },
    ],
    members: [
      {
        id: 'm1',
        nickname: 'Игрок Один',
        totals: dkpTotalsFixture(),
        balance: 80,
        details: [movement],
      },
    ],
    packs: [{ id: 'p1', name: 'Пак Один', totals: dkpTotalsFixture(), details: [movement] }],
    kps: [{ id: 'kp1', name: 'КП Альфа', totals: dkpTotalsFixture(), details: [movement] }],
    withoutEvent: {
      totals: dkpTotalsFixture({ earned: 0, spent: 0, adjustments: -5 }),
      members: [],
    },
    ...overrides,
  };
}

export function lootReportFixture(
  overrides: Partial<LootStatisticsReport> = {},
): LootStatisticsReport {
  const drop = {
    id: 'drop1',
    occurredAt: PERIOD.generatedAt,
    eventId: 'e1',
    eventName: 'Вечерний гильдбосс',
    eventStartsAt: '2026-12-05T18:00:00.000Z',
    eventTypeId: 't1',
    eventTypeName: 'Гильдбосс',
    mode: 'PVE' as const,
    packId: 'p1',
    kpId: 'kp1',
    teamStatus: 'KNOWN' as const,
    lotId: 'a1',
    lotStatus: 'CLOSED' as const,
  };
  const award = {
    id: 'aw1',
    memberId: 'm1',
    nickname: 'Игрок Один',
    itemId: 'i1',
    itemName: 'Клинок зари',
    rarity: 'Легендарный',
    slot: 'Оружие',
    isArchboss: false,
    auctionId: 'a1',
    finalPrice: 150,
    markupPct: 10,
    discountPct: 10,
    occurredAt: PERIOD.generatedAt,
    eventId: 'e1',
    eventName: 'Вечерний гильдбосс',
    eventStartsAt: '2026-12-05T18:00:00.000Z',
    eventTypeId: 't1',
    eventTypeName: 'Гильдбосс',
    mode: 'PVE' as const,
    packId: 'p1',
    kpId: 'kp1',
    teamStatus: 'KNOWN' as const,
  };
  const droppedItem = {
    itemId: 'i1',
    itemName: 'Клинок зари',
    rarity: 'Легендарный',
    slot: 'Оружие',
    isArchboss: false,
    count: 3,
    sharePct: 75,
    details: [drop],
  };
  return {
    generatedAt: PERIOD.generatedAt,
    start: PERIOD.start,
    end: PERIOD.end,
    dropped: {
      totals: { drops: 4, items: 2 },
      items: [droppedItem],
      withoutEvent: { totals: { drops: 0, items: 0 }, items: [] },
    },
    top: [
      {
        kind: 'ITEM' as const,
        itemId: 'i1',
        itemName: 'Клинок зари',
        rarity: 'Легендарный',
        slot: 'Оружие',
        isArchboss: false,
        count: 3,
        sharePct: 75,
      },
      {
        kind: 'ITEM' as const,
        itemId: 'i2',
        itemName: 'Плащ тьмы',
        rarity: 'Эпический 1',
        slot: 'Плащ',
        isArchboss: true,
        count: 1,
        sharePct: 25,
      },
    ],
    awarded: {
      totals: { awards: 1, spent: 150 },
      awards: [award],
      members: [{ id: 'm1', nickname: 'Игрок Один', totals: { awards: 1, spent: 150 } }],
      packs: [{ id: 'p1', name: 'Пак Один', totals: { awards: 1, spent: 150 } }],
      kps: [{ id: 'kp1', name: 'КП Альфа', totals: { awards: 1, spent: 150 } }],
      withoutEvent: { totals: { awards: 0, spent: 0 }, members: [] },
    },
    ...overrides,
  };
}

export function gearScoreReportFixture(
  overrides: Partial<GearScoreStatisticsReport> = {},
): GearScoreStatisticsReport {
  return {
    generatedAt: PERIOD.generatedAt,
    start: PERIOD.start,
    end: PERIOD.end,
    asOf: PERIOD.generatedAt,
    staleDays: 14,
    snapshotIgnoresFilters: ['eventTypeId', 'mode'],
    totals: { members: 6, fresh: 3, stale: 2, missing: 1, staleSharePct: 33 },
    members: [],
    ...overrides,
  };
}

export function baseReportFixture(overrides: Partial<StatisticsReport> = {}): StatisticsReport {
  return {
    generatedAt: PERIOD.generatedAt,
    start: PERIOD.start,
    end: PERIOD.end,
    weeks: [{ start: '2026-11-30T21:00:00.000Z', end: '2026-12-07T21:00:00.000Z' }],
    events: [
      {
        id: 'e1',
        startsAt: '2026-12-05T18:00:00.000Z',
        eventTypeId: 't1',
        mode: 'PVE',
        status: 'FINISHED',
        members: [],
      },
    ],
    facts: [],
    factsWithoutEvent: [],
    ...overrides,
  };
}

/** Мок api() с маршрутизацией по эндпоинтам статистики. */
type Lazy<T> = T | Promise<T> | (() => T | Promise<T>);

function resolveLazy<T>(response: Lazy<T>): Promise<T> {
  return Promise.resolve(
    typeof response === 'function' ? (response as () => T | Promise<T>)() : response,
  );
}

export function statisticsApiMock(responses: {
  base?: Array<Promise<StatisticsReport> | (() => Promise<StatisticsReport>)>;
  attendance?: Lazy<AttendanceReport>;
  activity?: Lazy<ActivityReport>;
  dkp?: Lazy<DkpStatisticsReport>;
  loot?: Lazy<LootStatisticsReport>;
  gearScore?: Lazy<GearScoreStatisticsReport>;
  /** Ответ /statistics/filter-options (#250): КП с паками, включая исторические. */
  filterOptions?: unknown;
  eventTypes?: unknown;
}) {
  const base = responses.base ?? [];
  const attendance = responses.attendance ?? attendanceReportFixture();
  const activity = responses.activity ?? activityReportFixture();
  const dkp = responses.dkp ?? dkpReportFixture();
  const loot = responses.loot ?? lootReportFixture();
  const gearScore = responses.gearScore ?? gearScoreReportFixture();
  const filterOptions = responses.filterOptions ?? {
    kps: [{ id: 'kp1', name: 'КП Альфа', packs: [{ id: 'p1', name: 'Пак Один' }] }],
  };
  const eventTypes = responses.eventTypes ?? [{ id: 't1', name: 'Гильдбосс' }];
  const calls: string[] = [];
  const implementation = (path: string): Promise<unknown> => {
    calls.push(path);
    if (path.startsWith('/statistics/filter-options')) return Promise.resolve(filterOptions);
    if (path.startsWith('/event-types')) return Promise.resolve(eventTypes);
    if (path.startsWith('/statistics/attendance')) return resolveLazy(attendance);
    if (path.startsWith('/statistics/activity')) return resolveLazy(activity);
    if (path.startsWith('/statistics/dkp')) return resolveLazy(dkp);
    if (path.startsWith('/statistics/loot')) return resolveLazy(loot);
    if (path.startsWith('/statistics/gear-score')) return resolveLazy(gearScore);
    if (path.startsWith('/statistics?')) {
      const next = base.shift();
      if (next === undefined) return Promise.reject(new Error('нет заготовленного ответа основы'));
      return typeof next === 'function' ? next() : next;
    }
    return Promise.reject(new Error(`неожиданный путь ${path}`));
  };
  return {
    implementation,
    calls,
    paths: (prefix: string) => calls.filter((path) => path.startsWith(prefix)),
  };
}

export const NOW = new Date('2026-11-30T23:00:00Z');
