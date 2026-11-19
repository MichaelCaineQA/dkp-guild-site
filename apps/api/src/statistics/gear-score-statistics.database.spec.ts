import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { GearScoreStatisticsService } from './gear-score-statistics.service';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';
import { ActivityStatisticsService } from './activity-statistics.service';
import { DkpStatisticsService } from './dkp-statistics.service';
import { LootStatisticsService } from './loot-statistics.service';
import type { PrismaService } from '../prisma/prisma.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * Сценарий приёмки #217: категории свежести на историческом срезе (точный
 * порог — в юнит-тестах shared), записи со скрином/без скрина, отсутствие
 * записи, загрузка после среза, исторический перевод, заблокированный
 * сейчас участник; матрица доступа — только Глава/Админ; общие отчёты
 * не раскрывают поля GS.
 */
suite('Свежесть GS в PostgreSQL', () => {
  const suffix = randomUUID().slice(0, 8);
  const ids: {
    guild: string;
    kps: string[];
    packs: string[];
    members: string[];
    records: string[];
    types: string[];
    settingExisted: boolean;
    settingPrevious: unknown;
  } = {
    guild: '',
    kps: [],
    packs: [],
    members: [],
    records: [],
    types: [],
    settingExisted: false,
    settingPrevious: null,
  };
  let db: PrismaClient;
  let service: GearScoreStatisticsService;

  const leader = { rank: 'GUILD_LEADER' as const, isAdmin: false, memberId: 'leader' };
  const officer = { rank: 'OFFICER' as const, isAdmin: false, memberId: 'officer' };
  const memberActor = { rank: 'MEMBER' as const, isAdmin: false, memberId: 'member' };
  const reserveAdmin = { rank: null, isAdmin: true, memberId: null };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new GearScoreStatisticsService(db as unknown as PrismaService);

    // Порог детерминирован для сценариев дат; прежнее значение возвращаем в afterAll.
    const key = 'profile.gearScoreStaleDays';
    const previous = await db.setting.findUnique({ where: { key } });
    ids.settingExisted = !!previous;
    ids.settingPrevious = previous?.value ?? null;
    await db.setting.upsert({
      where: { key },
      update: { value: 14 },
      create: { key, value: 14 },
    });

    const old = new Date('2025-01-01T00:00:00Z');
    ids.guild = (
      await db.guild.create({
        data: { name: `gsstats-${suffix}`, gameTimeAnchor: old, createdAt: old },
      })
    ).id;
    for (const name of ['alpha', 'beta']) {
      ids.kps.push(
        (
          await db.kP.create({
            data: { name: `gsstats-${name}-${suffix}`, guildId: ids.guild, createdAt: old },
          })
        ).id,
      );
      ids.packs.push(
        (
          await db.pack.create({
            data: {
              name: `gsstats-${name}-${suffix}`,
              kpId: ids.kps[ids.kps.length - 1]!,
              createdAt: old,
            },
          })
        ).id,
      );
    }
    const [kp1, pack1, pack2] = [ids.kps[0]!, ids.packs[0]!, ids.packs[1]!];
    ids.types.push((await db.eventType.create({ data: { name: `gsstats-raid-${suffix}` } })).id);

    // Состав июня: m1..m7 и m9 созданы заранее, m8 — после среза (июль).
    // m6 на срезе в первом паке, с августа — во втором; m4 без истории переносов.
    const memberRows: {
      key: string;
      nickname: string;
      packId: string;
      createdAt: Date;
      blockedAt?: Date;
      history: { previousPackId: string | null; packId: string; changedAt: Date }[];
    }[] = [
      {
        key: 'm1',
        nickname: 'gsstats-fresh-' + suffix,
        packId: pack1,
        createdAt: old,
        history: [
          { previousPackId: pack1, packId: pack1, changedAt: new Date('2025-12-01T00:00:00Z') },
        ],
      },
      {
        key: 'm2',
        nickname: 'gsstats-stale-' + suffix,
        packId: pack1,
        createdAt: old,
        history: [
          { previousPackId: pack1, packId: pack1, changedAt: new Date('2025-12-01T00:00:00Z') },
        ],
      },
      {
        key: 'm3',
        nickname: 'gsstats-noshot-' + suffix,
        packId: pack1,
        createdAt: old,
        history: [
          { previousPackId: pack1, packId: pack1, changedAt: new Date('2025-12-01T00:00:00Z') },
        ],
      },
      {
        key: 'm4',
        nickname: 'gsstats-nohist-' + suffix,
        packId: pack1,
        createdAt: old,
        history: [],
      },
      {
        key: 'm5',
        nickname: 'gsstats-late-' + suffix,
        packId: pack1,
        createdAt: old,
        history: [
          { previousPackId: pack1, packId: pack1, changedAt: new Date('2025-12-01T00:00:00Z') },
        ],
      },
      {
        key: 'm6',
        nickname: 'gsstats-moved-' + suffix,
        packId: pack2,
        createdAt: old,
        history: [
          { previousPackId: pack1, packId: pack1, changedAt: new Date('2025-12-01T00:00:00Z') },
          { previousPackId: pack1, packId: pack2, changedAt: new Date('2026-08-01T00:00:00Z') },
        ],
      },
      {
        key: 'm7',
        nickname: 'gsstats-blocked-' + suffix,
        packId: pack1,
        createdAt: old,
        blockedAt: new Date('2026-10-01T00:00:00Z'),
        history: [
          { previousPackId: pack1, packId: pack1, changedAt: new Date('2025-12-01T00:00:00Z') },
        ],
      },
      {
        key: 'm8',
        nickname: 'gsstats-new-' + suffix,
        packId: pack2,
        createdAt: new Date('2026-07-15T00:00:00Z'),
        history: [
          { previousPackId: pack2, packId: pack2, changedAt: new Date('2026-07-15T00:00:00Z') },
        ],
      },
      {
        key: 'm9',
        nickname: 'gsstats-norecords-' + suffix,
        packId: pack2,
        createdAt: old,
        history: [
          { previousPackId: pack2, packId: pack2, changedAt: new Date('2025-12-01T00:00:00Z') },
        ],
      },
    ];
    for (const row of memberRows) {
      const created = await db.member.create({
        data: {
          nickname: row.nickname,
          packId: row.packId,
          createdAt: row.createdAt,
          blockedAt: row.blockedAt ?? null,
        },
      });
      ids.members.push(created.id);
      for (const change of row.history) {
        await db.memberPackHistory.create({
          data: { memberId: created.id, ...change },
        });
      }
    }
    for (const packId of ids.packs) {
      const kpId = packId === pack1 ? kp1 : ids.kps[1]!;
      await db.packMembershipHistory.create({
        data: { packId, previousKpId: kpId, kpId, changedAt: new Date('2025-12-01T00:00:00Z') },
      });
    }

    const byKey = (key: string) => ids.members[memberRows.findIndex((row) => row.key === key)]!;
    // Записи GS: со скрином / без скрина / после среза (у m5 — август).
    const recordRows: { key: string; at: string; shots: number; value: number }[] = [
      { key: 'm1', at: '2026-06-20T12:00:00Z', shots: 1, value: 3100 },
      { key: 'm2', at: '2026-06-10T12:00:00Z', shots: 1, value: 3200 },
      { key: 'm2', at: '2026-06-25T12:00:00Z', shots: 0, value: 3300 },
      { key: 'm3', at: '2026-06-15T12:00:00Z', shots: 0, value: 3400 },
      { key: 'm4', at: '2026-06-20T12:00:00Z', shots: 1, value: 3500 },
      { key: 'm5', at: '2026-08-15T12:00:00Z', shots: 1, value: 3600 },
      { key: 'm6', at: '2026-06-20T12:00:00Z', shots: 1, value: 3700 },
      { key: 'm7', at: '2026-06-20T12:00:00Z', shots: 1, value: 3800 },
    ];
    for (const row of recordRows) {
      ids.records.push(
        (
          await db.gearScoreRecord.create({
            data: {
              memberId: byKey(row.key),
              value: row.value,
              createdAt: new Date(row.at),
              screenshotIds: Array.from(
                { length: row.shots },
                (_, i) => `shot-${suffix}-${i}-${row.at}`,
              ),
            },
          })
        ).id,
      );
    }
  });

  afterAll(async () => {
    if (!db) return;
    const key = 'profile.gearScoreStaleDays';
    if (ids.settingExisted) {
      await db.setting.update({ where: { key }, data: { value: ids.settingPrevious as never } });
    } else {
      await db.setting.deleteMany({ where: { key } });
    }
    await db.gearScoreRecord.deleteMany({ where: { id: { in: ids.records } } });
    await db.memberPackHistory.deleteMany({ where: { memberId: { in: ids.members } } });
    await db.packMembershipHistory.deleteMany({ where: { packId: { in: ids.packs } } });
    await db.member.deleteMany({ where: { id: { in: ids.members } } });
    await db.pack.deleteMany({ where: { id: { in: ids.packs } } });
    await db.kP.deleteMany({ where: { id: { in: ids.kps } } });
    await db.eventType.deleteMany({ where: { id: { in: ids.types } } });
    await db.guild.deleteMany({ where: { id: ids.guild } });
    await db.$disconnect();
  });

  const june = { from: '2026-06-01', to: '2026-06-30' };
  const nick = (key: string) => `gsstats-${key}-${suffix}`;
  const rowOf = (report: Awaited<ReturnType<typeof service.get>>, key: string) =>
    report.members.find((row) => row.nickname === nick(key))!;

  it('категории среза июня и явные источник даты с порогом', async () => {
    const report = await service.get(june, leader);
    // Прошлый период: срез на конец периода (полночь 1 июля Москвы).
    expect(report.asOf).toBe('2026-06-30T21:00:00.000Z');
    expect(report.staleDays).toBe(14);
    expect(report.snapshotIgnoresFilters).toEqual([]);
    expect(rowOf(report, 'fresh')).toMatchObject({
      freshness: 'FRESH',
      lastScreenshotAt: '2026-06-20T12:00:00.000Z',
    });
    // Свежая запись без скрина не освежает: последняя со скрином — 10 июня.
    expect(rowOf(report, 'stale')).toMatchObject({
      freshness: 'STALE',
      lastScreenshotAt: '2026-06-10T12:00:00.000Z',
    });
    // Запись есть, но без скрина — скрин отсутствует; как и полное отсутствие записей.
    expect(rowOf(report, 'noshot')).toMatchObject({ freshness: 'MISSING', lastScreenshotAt: null });
    expect(rowOf(report, 'norecords')).toMatchObject({
      freshness: 'MISSING',
      lastScreenshotAt: null,
    });
    // Запись августа на июньском срезе не видна.
    expect(rowOf(report, 'late')).toMatchObject({ freshness: 'MISSING', lastScreenshotAt: null });
    // Недостаточная история состава — не «нет скрина»: категория свежести считается.
    expect(rowOf(report, 'nohist')).toMatchObject({
      freshness: 'FRESH',
      packId: null,
      kpId: null,
      teamStatus: 'NO_HISTORICAL_DATA',
      membershipStatus: 'NO_HISTORICAL_DATA',
    });
    // Исторический перевод: на срезе участник в прежнем паке и КП.
    expect(rowOf(report, 'moved')).toMatchObject({
      packId: ids.packs[0],
      kpId: ids.kps[0],
      teamStatus: 'KNOWN',
      membershipStatus: 'NO_HISTORICAL_DATA',
      freshness: 'FRESH',
    });
    // Заблокированный сейчас участник остаётся в прошлом срезе с пометкой о составе.
    expect(rowOf(report, 'blocked')).toMatchObject({
      teamStatus: 'KNOWN',
      membershipStatus: 'NO_HISTORICAL_DATA',
      freshness: 'FRESH',
    });
    // Созданный после среза в прошлый отчёт не входит.
    expect(report.members.find((row) => row.nickname === nick('new'))).toBeUndefined();
    expect(report.totals).toEqual({
      members: 8,
      fresh: 4,
      stale: 1,
      missing: 3,
      staleSharePct: 13,
    });
  });

  it('загрузка после среза прошлый отчёт не меняет, текущий видит новую запись', async () => {
    const before = await service.get(june, leader);
    const created = await db.gearScoreRecord.create({
      data: {
        memberId: ids.members[4]!,
        value: 3900,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        screenshotIds: [`shot-${suffix}-fresh`],
      },
    });
    ids.records.push(created.id);
    const after = await service.get(june, leader);
    expect(after.totals).toEqual(before.totals);
    expect(rowOf(after, 'late')).toMatchObject({ freshness: 'MISSING', lastScreenshotAt: null });
    // Текущий месяц: срез на момент отчёта, новая запись уже видна.
    // Итоги текущего среза не проверяем абсолютно: без фильтров в выборку
    // входят все участники общей тест-базы; категории — построчно.
    const current = await service.get({}, leader);
    expect(current.asOf).toBe(current.generatedAt);
    expect(rowOf(current, 'late')).toMatchObject({ freshness: 'FRESH' });
    // Перевод виден текущему срезу: m6 уже во втором паке.
    expect(rowOf(current, 'moved')).toMatchObject({
      packId: ids.packs[1],
      kpId: ids.kps[1],
      teamStatus: 'KNOWN',
    });
    // Текущий срез: созданный в июле участник входит, заблокированный скрыт.
    expect(rowOf(current, 'new')).toMatchObject({
      freshness: 'MISSING',
      membershipStatus: 'KNOWN',
    });
    expect(current.members.find((row) => row.nickname === nick('blocked'))).toBeUndefined();
    // Августовская запись на текущем срезе устарела, июньские — тем более.
    expect(rowOf(current, 'fresh')).toMatchObject({ freshness: 'STALE' });
    expect(rowOf(current, 'stale')).toMatchObject({ freshness: 'STALE' });
  });

  it('фильтры КП/пака по исторической команде, ивентные фильтры валидируются и не влияют', async () => {
    const pack1 = await service.get({ ...june, packId: ids.packs[0]! }, leader);
    // m9 на срезе во втором паке — исключён; m4 без истории — консервативно включён.
    expect(pack1.members.map((row) => row.nickname)).toEqual(
      [
        nick('fresh'),
        nick('nohist'),
        nick('noshot'),
        nick('stale'),
        nick('late'),
        nick('moved'),
        nick('blocked'),
      ].sort((a, b) => a.localeCompare(b, 'ru')),
    );
    const pack2 = await service.get({ ...june, packId: ids.packs[1]! }, leader);
    // m4 без истории включается консервативно в любой командный фильтр.
    expect(pack2.members.map((row) => row.nickname)).toEqual([nick('nohist'), nick('norecords')]);
    const kp1 = await service.get({ ...june, kpId: ids.kps[0]! }, leader);
    expect(kp1.members).toHaveLength(7);
    // У среза нет фактов ивентов: фильтры валидируются, выборку не меняют.
    const withEventFilters = await service.get(
      { ...june, eventTypeId: ids.types[0]!, mode: 'PVP' },
      leader,
    );
    expect(withEventFilters.snapshotIgnoresFilters).toEqual(['eventTypeId', 'mode']);
    expect(withEventFilters.totals).toEqual((await service.get(june, leader)).totals);
    await expect(service.get({ ...june, eventTypeId: 'missing' }, leader)).rejects.toThrow(
      'Неизвестный фильтр',
    );
    await expect(service.get({ ...june, kpId: 'missing' }, leader)).rejects.toThrow(
      'Неизвестный фильтр',
    );
  });

  it('матрица доступа: блок только Главе и резервному Админу', async () => {
    await expect(service.get(june, memberActor)).rejects.toThrow(
      'Блок свежести GS доступен только Главе и Админу',
    );
    await expect(service.get(june, officer)).rejects.toThrow(
      'Блок свежести GS доступен только Главе и Админу',
    );
    await expect(service.get(june, { rank: null, isAdmin: false, memberId: 'x' })).rejects.toThrow(
      'Блок свежести GS доступен только Главе и Админу',
    );
    await expect(service.get(june, leader)).resolves.toBeTruthy();
    await expect(service.get(june, reserveAdmin)).resolves.toBeTruthy();
  });

  it('общие отчёты доступны без полей GS', async () => {
    const services = [
      new StatisticsService(db as unknown as PrismaService),
      new AttendanceStatisticsService(db as unknown as PrismaService),
      new ActivityStatisticsService(db as unknown as PrismaService),
      new DkpStatisticsService(db as unknown as PrismaService),
      new LootStatisticsService(db as unknown as PrismaService),
    ];
    for (const common of services) {
      const report = await common.get(june);
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain('gearScore');
      expect(serialized).not.toContain('freshness');
      expect(serialized).not.toContain('staleDays');
      expect(serialized).not.toContain('lastScreenshotAt');
    }
  });
});
