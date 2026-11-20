import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from '@dkp/shared';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';
import { ActivityStatisticsService } from './activity-statistics.service';
import { DkpStatisticsService } from './dkp-statistics.service';
import { LootStatisticsService } from './loot-statistics.service';
import { GearScoreStatisticsService } from './gear-score-statistics.service';
import { StatisticsCsvService } from './statistics-csv.service';
import type { PrismaService } from '../prisma/prisma.service';

let actor: SessionUser | undefined;
/** Пустая БД: привилегированный путь завершается пустым отчётом без доступа к данным. */
const emptySnapshotDb = {
  $transaction: (callback: (tx: unknown) => unknown) => callback(emptySnapshotDb),
  kP: { findMany: async () => [], findUnique: async () => null },
  pack: { findMany: async () => [], findUnique: async () => null },
  member: { findMany: async () => [] },
  gearScoreRecord: { findMany: async () => [] },
  eventType: { findUnique: async () => null },
  setting: { findMany: async () => [] },
};

/** Контрольный набор длиннее любой «страницы» интерфейса: 120 строк. */
const attendanceReport = {
  generatedAt: '2026-12-02T12:00:00.000Z',
  start: '2026-11-30T21:00:00.000Z',
  end: '2026-12-31T21:00:00.000Z',
  overview: {
    activeMembers: 120,
    finishedEvents: 3,
    totals: {
      checks: 240,
      events: 360,
      percentage: 33.3,
      excused: 0,
      noShow: 0,
      late: 0,
      leftEarly: 0,
      historyStatus: 'KNOWN',
    },
  },
  weeks: [],
  members: Array.from({ length: 120 }, (_, index) => ({
    id: `m${index}`,
    name: `Игрок ${index + 1}`,
    avatar: null,
    avatarColor: null,
    totals: {
      checks: 2,
      events: 3,
      percentage: 33.3,
      excused: 0,
      noShow: 0,
      late: 0,
      leftEarly: 0,
      historyStatus: 'KNOWN',
    },
  })),
  packs: [],
  kps: [],
  top: [],
  details: [],
};
const activityReport = {
  generatedAt: attendanceReport.generatedAt,
  start: attendanceReport.start,
  end: attendanceReport.end,
  overview: {
    activeMembers: 1,
    totals: {
      events: 1,
      counted: 1,
      visited: 1,
      checks: 2,
      attendance: 100,
      historyStatus: 'KNOWN',
    },
  },
  weeks: [],
  byType: [],
  byMode: [],
  peak: { byWeekday: [], byHour: [] },
  members: [],
  events: [],
};
const dkpReport = {
  generatedAt: attendanceReport.generatedAt,
  start: attendanceReport.start,
  end: attendanceReport.end,
  balanceAsOf: attendanceReport.generatedAt,
  balanceIgnoresFilters: ['eventTypeId', 'mode'],
  totals: { earned: 300, spent: -120, adjustments: -30, net: 150 },
  weeks: [],
  members: [
    {
      id: 'm1',
      nickname: '=SUM(A1)',
      totals: { earned: 300, spent: -120, adjustments: -30, net: 150 },
      balance: 150,
      details: [
        {
          id: 'd1',
          memberId: 'm1',
          nickname: '=SUM(A1)',
          type: 'MANUAL_EARN',
          amount: 300,
          occurredAt: '2026-12-01T12:00:00.000Z',
          comment: null,
          eventId: null,
          eventName: null,
          startsAt: null,
          eventTypeId: null,
          eventTypeName: null,
          mode: null,
          auctionId: null,
          auctionItemName: null,
          packId: null,
          kpId: null,
          teamStatus: 'NO_HISTORICAL_DATA',
        },
      ],
    },
  ],
  packs: [],
  kps: [],
  withoutEvent: { totals: { earned: 0, spent: 0, adjustments: 0, net: 0 }, members: [] },
};
const lootReport = {
  generatedAt: attendanceReport.generatedAt,
  start: attendanceReport.start,
  end: attendanceReport.end,
  dropped: {
    totals: { drops: 2, items: 1 },
    items: [
      {
        itemId: 'i1',
        itemName: 'Клинок; зари',
        rarity: null,
        slot: null,
        isArchboss: false,
        count: 2,
        sharePct: 100,
        details: [],
      },
    ],
    withoutEvent: { totals: { drops: 0, items: 0 }, items: [] },
  },
  top: [],
  awarded: {
    totals: { awards: 0, spent: 0 },
    awards: [],
    members: [],
    packs: [],
    kps: [],
    withoutEvent: { totals: { awards: 0, spent: 0 }, members: [] },
  },
};

@Module({
  controllers: [StatisticsController],
  providers: [
    {
      provide: StatisticsService,
      useValue: { get: () => ({ events: [] }), filterOptions: async () => ({ kps: [] }) },
    },
    { provide: AttendanceStatisticsService, useValue: { get: async () => attendanceReport } },
    { provide: ActivityStatisticsService, useValue: { get: async () => activityReport } },
    { provide: DkpStatisticsService, useValue: { get: async () => dkpReport } },
    { provide: LootStatisticsService, useValue: { get: async () => lootReport } },
    {
      provide: GearScoreStatisticsService,
      useValue: new GearScoreStatisticsService(emptySnapshotDb as unknown as PrismaService),
    },
    StatisticsCsvService,
  ],
})
class TestModule {}

describe('Доступ к статистике через HTTP', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { session: { user: actor } });
      next();
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => app.close());
  const member: SessionUser = {
    userId: 'u',
    username: 'test',
    memberId: 'm',
    rank: 'MEMBER',
    isAdmin: false,
    blocked: false,
  };
  it('отказывает без входа', async () => {
    actor = undefined;
    expect((await fetch(`${url}/statistics`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/filter-options`)).status).toBe(401);
  });
  it('отказывает ожидающему участнику', async () => {
    actor = { ...member, memberId: null, rank: null };
    expect((await fetch(`${url}/statistics`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/filter-options`)).status).toBe(403);
  });
  it('отказывает заблокированному участнику', async () => {
    actor = { ...member, blocked: true };
    expect((await fetch(`${url}/statistics`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(403);
  });
  it.each(['MEMBER', 'OFFICER', 'GUILD_LEADER'] as const)('разрешает ранг %s', async (rank) => {
    actor = { ...member, rank };
    expect((await fetch(`${url}/statistics`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(200);
  });
  it('разрешает резервного администратора', async () => {
    actor = { ...member, memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/statistics`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(200);
  });

  /**
   * Матрица блока GS (#217, план 2.5): только Глава и резервный Админ.
   * Лидерство КП/пака и назначение РЛ не входят в проверку видимости GS —
   * для них доступ определяется рангом (MEMBER/OFFICER), поэтому отдельные
   * строки матрицы не нужны: ранговые 403 закрывают и лидеров с РЛ.
   */
  it('блок GS: Глава и резервный Админ проходят, остальные ранги — 403', async () => {
    const leader: SessionUser = { ...member, rank: 'GUILD_LEADER' };
    actor = leader;
    const leaderResponse = await fetch(`${url}/statistics/gear-score`);
    expect(leaderResponse.status).toBe(200);
    await expect(leaderResponse.json()).resolves.toMatchObject({
      totals: { members: 0, fresh: 0, stale: 0, missing: 0, staleSharePct: null },
      members: [],
    });
    actor = { ...member, memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(200);
    actor = { ...member, rank: 'MEMBER' };
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(403);
    actor = { ...member, rank: 'OFFICER' };
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(403);
  });

  // ——— CSV-экспорт (#223): те же права, файл целиком, защита данных ———

  const csvEndpoints = () => [
    `${url}/statistics/attendance/export.csv?cut=members&from=2026-12-01&to=2026-12-31`,
    `${url}/statistics/activity/export.csv?table=members&from=2026-12-01&to=2026-12-31`,
    `${url}/statistics/dkp/export.csv?table=members&from=2026-12-01&to=2026-12-31`,
    `${url}/statistics/loot/export.csv?table=dropped&from=2026-12-01&to=2026-12-31`,
    `${url}/statistics/export.csv?table=top&from=2026-12-01&to=2026-12-31`,
  ];

  it('CSV: без входа, ожидающий и заблокированный не скачивают', async () => {
    actor = undefined;
    for (const endpoint of csvEndpoints()) expect((await fetch(endpoint)).status).toBe(401);
    actor = { ...member, memberId: null, rank: null };
    for (const endpoint of csvEndpoints()) expect((await fetch(endpoint)).status).toBe(403);
    actor = { ...member, blocked: true };
    for (const endpoint of csvEndpoints()) expect((await fetch(endpoint)).status).toBe(403);
  });

  it('CSV: участник скачивает файл с BOM, периодом и всей выборкой', async () => {
    actor = member;
    const response = await fetch(csvEndpoints()[0]!);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('.csv');
    const text = await response.text();
    // BOM виден в байтах: text() декодирует UTF-8 и снимает его.
    const bytes = new Uint8Array(await (await fetch(csvEndpoints()[0]!)).arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    // Вся серверная выборка длиннее страницы: все 120 строк и согласованные суммы.
    const dataRows = text.split('\r\n').filter((line) => line.startsWith('Игрок '));
    expect(dataRows).toHaveLength(120);
    expect(text).toContain('# Период: 01.12.2026–31.12.2026 (по Москве, UTC+3)');
    expect(text).toContain('# Дата среза:');
    expect(text).toContain('Формула:');
    // 33,3% — процент с запятой, пустой не появился.
    expect(text).toContain('33,3');
  });

  it('CSV: кириллица, кавычки и текст со знаком формулы защищены', async () => {
    actor = member;
    const dkp = await (await fetch(csvEndpoints()[2]!)).text();
    // Ник "=SUM(A1)" префиксован апострофом и не выполняется редактором.
    expect(dkp).toContain("'=SUM(A1)");
    const loot = await (await fetch(csvEndpoints()[3]!)).text();
    // Предмет с разделителем в имени заквочен.
    expect(loot).toContain('"Клинок; зари"');
  });

  it('CSV: GS-выгрузка только Главе/Админу, обычные таблицы без закрытых данных', async () => {
    actor = member;
    expect(
      (await fetch(`${url}/statistics/export.csv?table=gear-score&from=2026-12-01&to=2026-12-31`))
        .status,
    ).toBe(403);
    actor = { ...member, rank: 'OFFICER' };
    expect(
      (await fetch(`${url}/statistics/export.csv?table=gear-score&from=2026-12-01&to=2026-12-31`))
        .status,
    ).toBe(403);
    actor = { ...member, rank: 'GUILD_LEADER' };
    const leaderCsv = await fetch(
      `${url}/statistics/export.csv?table=gear-score&from=2026-12-01&to=2026-12-31`,
    );
    expect(leaderCsv.status).toBe(200);
    const leaderText = await leaderCsv.text();
    expect(leaderText).toContain('Срез GS');
    actor = { ...member, memberId: null, rank: null, isAdmin: true };
    expect(
      (await fetch(`${url}/statistics/export.csv?table=gear-score&from=2026-12-01&to=2026-12-31`))
        .status,
    ).toBe(200);
  });

  it('CSV: неизвестная таблица — 400, а не пустой файл', async () => {
    actor = member;
    expect((await fetch(`${url}/statistics/attendance/export.csv?cut=nope`)).status).toBe(400);
    expect((await fetch(`${url}/statistics/dkp/export.csv?table=nope`)).status).toBe(400);
  });
});
