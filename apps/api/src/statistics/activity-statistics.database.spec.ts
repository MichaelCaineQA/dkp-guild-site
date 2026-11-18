import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ActivityStatisticsService } from './activity-statistics.service';
import type { PrismaService } from '../prisma/prisma.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Статистика активности в PostgreSQL', () => {
  const suffix = randomUUID().slice(0, 8);
  const ids: {
    guild: string;
    kp: string;
    pack: string;
    members: string[];
    types: string[];
    events: string[];
    absences: string[];
  } = {
    guild: '',
    kp: '',
    pack: '',
    members: [],
    types: [],
    events: [],
    absences: [],
  };
  let db: PrismaClient;
  let service: ActivityStatisticsService;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new ActivityStatisticsService(db as PrismaService);

    const old = new Date('2025-01-01T00:00:00Z');
    ids.guild = (
      await db.guild.create({
        data: { name: `actstats-${suffix}`, gameTimeAnchor: old, createdAt: old },
      })
    ).id;
    ids.kp = (
      await db.kP.create({
        data: { name: `actstats-${suffix}`, guildId: ids.guild, createdAt: old },
      })
    ).id;
    ids.pack = (
      await db.pack.create({ data: { name: `actstats-${suffix}`, kpId: ids.kp, createdAt: old } })
    ).id;
    for (const nickname of ['alpha', 'beta']) {
      const member = await db.member.create({
        data: { nickname: `actstats-${nickname}-${suffix}`, packId: ids.pack, createdAt: old },
      });
      ids.members.push(member.id);
    }
    for (const name of ['raid', 'siege']) {
      ids.types.push((await db.eventType.create({ data: { name: `actstats-${name}-${suffix}` } })).id);
    }
    // История принадлежности делает команды на момент ивентов известными.
    for (const memberId of ids.members) {
      await db.memberPackHistory.create({
        data: {
          memberId,
          previousPackId: ids.pack,
          packId: ids.pack,
          changedAt: new Date('2025-12-01T00:00:00Z'),
        },
      });
    }
    await db.packMembershipHistory.create({
      data: {
        packId: ids.pack,
        previousKpId: ids.kp,
        kpId: ids.kp,
        changedAt: new Date('2025-12-01T00:00:00Z'),
      },
    });

    const scenarios = [
      { day: '04', type: ids.types[0]!, mode: 'PVE' as const, scope: 'GUILD' as const },
      { day: '11', type: ids.types[0]!, mode: 'PVE' as const, scope: 'GUILD' as const },
      { day: '18', type: ids.types[0]!, mode: 'PVE' as const, scope: 'PACK' as const },
      { day: '25', type: ids.types[1]!, mode: 'PVP' as const, scope: 'GUILD' as const },
    ];
    for (const scenario of scenarios) {
      const startsAt = new Date(`2026-06-${scenario.day}T16:00:00Z`);
      const event = await db.event.create({
        data: {
          name: `actstats-${scenario.day}-${suffix}`,
          eventTypeId: scenario.type,
          mode: scenario.mode,
          scope: scenario.scope,
          packId: scenario.scope === 'PACK' ? ids.pack : null,
          status: 'FINISHED',
          raidLeadId: ids.members[0]!,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
          dkpReward: 0,
        },
      });
      ids.events.push(event.id);
    }
    await db.attendance.create({
      data: {
        eventId: ids.events[0]!,
        memberId: ids.members[0]!,
        checkinStart: 'PASSED',
        checkinEnd: 'PASSED',
      },
    });
    await db.attendance.create({
      data: {
        eventId: ids.events[0]!,
        memberId: ids.members[1]!,
        checkinStart: 'PASSED',
      },
    });
    await db.attendance.create({
      data: { eventId: ids.events[1]!, memberId: ids.members[0]!, checkinStart: 'MANUAL' },
    });
    await db.attendance.create({
      data: {
        eventId: ids.events[3]!,
        memberId: ids.members[0]!,
        checkinStart: 'PASSED',
        checkinEnd: 'PASSED',
      },
    });
    const packEvent = await db.event.findUniqueOrThrow({ where: { id: ids.events[2]! } });
    ids.absences.push(
      (
        await db.absence.create({
          data: {
            memberId: ids.members[0]!,
            dateFrom: packEvent.startsAt,
            dateTo: packEvent.endsAt,
            reason: `actstats private ${suffix}`,
            status: 'ACTIVE',
          },
        })
      ).id,
    );
  });

  afterAll(async () => {
    if (!db) return;
    await db.absence.deleteMany({ where: { id: { in: ids.absences } } });
    await db.attendance.deleteMany({
      where: { eventId: { in: ids.events }, memberId: { in: ids.members } },
    });
    await db.event.deleteMany({ where: { id: { in: ids.events } } });
    await db.memberPackHistory.deleteMany({ where: { memberId: { in: ids.members } } });
    await db.packMembershipHistory.deleteMany({ where: { packId: ids.pack } });
    await db.member.deleteMany({ where: { id: { in: ids.members } } });
    await db.pack.deleteMany({ where: { id: ids.pack } });
    await db.kP.deleteMany({ where: { id: ids.kp } });
    await db.guild.deleteMany({ where: { id: ids.guild } });
    await db.eventType.deleteMany({ where: { id: { in: ids.types } } });
    await db.$disconnect();
  });

  const june = { from: '2026-06-01', to: '2026-06-30' };

  it('counts each event once, keeps halves in the percentage and labels scopes', async () => {
    const report = await service.get({ ...june, eventTypeId: ids.types[0] });
    // Три ивента, пять участвий: участники не умножают число событий.
    expect(report.overview).toEqual({
      activeMembers: 2,
      totals: {
        events: 3,
        counted: 5,
        visited: 3,
        checks: 4,
        attendance: 40,
        historyStatus: 'NO_HISTORICAL_DATA',
      },
    });
    const byId = new Map(report.events.map((row) => [row.id, row]));
    expect(byId.get(ids.events[0]!)).toMatchObject({
      scope: 'GUILD',
      scopeName: 'Вся гильдия',
      invited: 2,
      counted: 2,
      visited: 2,
      checks: 3,
      attendance: 75,
    });
    expect(byId.get(ids.events[1]!)).toMatchObject({
      invited: 2,
      counted: 2,
      visited: 1,
      checks: 1,
      attendance: 25,
    });
    expect(byId.get(ids.events[2]!)).toMatchObject({
      scope: 'PACK',
      scopeName: `actstats-${suffix}`,
      invited: 2,
      counted: 1,
      visited: 0,
      checks: 0,
      attendance: 0,
    });
    expect(report.members.map((row) => row.id)).toEqual([ids.members[0], ids.members[1]]);
    expect(report.members[0]).toMatchObject({
      // Уважительное отсутствие остаётся участием без посещения и отметок.
      totals: { events: 3, visited: 2, checks: 3 },
    });
    expect(report.members[1]).toMatchObject({
      totals: { events: 3, visited: 1, checks: 1 },
    });
    expect(JSON.stringify(report)).not.toContain(`actstats private ${suffix}`);
  });

  it('splits types and modes with the same aggregates', async () => {
    const report = await service.get(june);
    expect(report.byType.map((row) => row.eventTypeId)).toEqual(ids.types);
    expect(report.byType[0]!.totals).toMatchObject({ events: 3, visited: 3, checks: 4 });
    expect(report.byType[1]!.totals).toMatchObject({ events: 1, visited: 1, checks: 2 });
    expect(report.byMode).toEqual([
      expect.objectContaining({
        mode: 'PVE',
        totals: {
          events: 3,
          counted: 5,
          visited: 3,
          checks: 4,
          attendance: 40,
          historyStatus: 'NO_HISTORICAL_DATA',
        },
      }),
      expect.objectContaining({
        mode: 'PVP',
        totals: {
          events: 1,
          counted: 2,
          visited: 1,
          checks: 2,
          attendance: 50,
          historyStatus: 'NO_HISTORICAL_DATA',
        },
      }),
    ]);
  });

  it('converges weekly totals with the overall total', async () => {
    const report = await service.get({ ...june, eventTypeId: ids.types[0] });
    expect(report.weeks.map((week) => week.totals.events)).toEqual([1, 1, 1, 0, 0]);
    for (const key of ['events', 'counted', 'visited', 'checks'] as const) {
      expect(report.weeks.reduce((sum, week) => sum + week.totals[key], 0)).toBe(
        report.overview.totals[key],
      );
    }
  });

  it('buckets the Moscow peak with explicit zeros', async () => {
    const report = await service.get({ ...june, eventTypeId: ids.types[0] });
    expect(report.peak.byWeekday).toHaveLength(7);
    expect(report.peak.byHour).toHaveLength(24);
    // Все ивенты — четверги 19:00 Москвы: 4 июня два посещения, 11 июня одно.
    expect(report.peak.byWeekday[3]).toEqual({ weekday: 3, visited: 3 });
    expect(report.peak.byWeekday.filter((bucket) => bucket.visited === 0)).toHaveLength(6);
    expect(report.peak.byHour[19]).toEqual({ hour: 19, visited: 3 });
    expect(
      report.peak.byWeekday.reduce((sum, bucket) => sum + bucket.visited, 0),
    ).toBe(report.overview.totals.visited);
  });

  it('keeps historical teams in details when the player moves between packs', async () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const otherKp = await db.kP.create({
      data: { name: `actstats-other-${suffix}`, guildId: ids.guild, createdAt },
    });
    const otherPack = await db.pack.create({
      data: { name: `actstats-other-${suffix}`, kpId: otherKp.id, createdAt },
    });
    try {
      // История новой паки делает её КП на момент ивента известной.
      await db.packMembershipHistory.create({
        data: {
          packId: otherPack.id,
          previousKpId: otherKp.id,
          kpId: otherKp.id,
          changedAt: new Date('2025-12-01T00:00:00Z'),
        },
      });
      await db.$transaction([
        db.member.update({
          where: { id: ids.members[0]! },
          data: { packId: otherPack.id },
        }),
        db.memberPackHistory.create({
          data: {
            memberId: ids.members[0]!,
            previousPackId: ids.pack,
            packId: otherPack.id,
            changedAt: new Date('2026-06-05T00:00:00Z'),
          },
        }),
      ]);
      const query = { ...june, eventTypeId: ids.types[0] };
      const report = await service.get(query);
      const moved = report.members.find((row) => row.id === ids.members[0])!;
      // Историческая команда видна в деталях и не переносится новой паку/КП.
      expect(moved.details.map((detail) => [detail.eventId, detail.packId, detail.kpId])).toEqual([
        [ids.events[0], ids.pack, ids.kp],
        [ids.events[1], otherPack.id, otherKp.id],
      ]);
      // PACK-ивент старого пака больше не приглашает переехавшего.
      expect(moved.details.map((detail) => detail.eventId)).not.toContain(ids.events[2]);
      // Фильтр старой КП сохраняет только участия той команды.
      const oldKp = await service.get({ ...query, kpId: ids.kp });
      const oldKpMember = oldKp.members.find((row) => row.id === ids.members[0])!;
      expect(oldKpMember.details).toHaveLength(1);
      expect(oldKpMember.details[0]).toMatchObject({
        eventId: ids.events[0],
        packId: ids.pack,
        kpId: ids.kp,
      });
      expect(oldKp.overview.totals.events).toBe(3);
      const newPack = await service.get({ ...query, packId: otherPack.id });
      expect(newPack.overview.totals).toMatchObject({ events: 1, visited: 1 });
      expect(newPack.members[0]!.details[0]).toMatchObject({ packId: otherPack.id });
    } finally {
      await db.packMembershipHistory.deleteMany({ where: { packId: otherPack.id } });
      await db.memberPackHistory.deleteMany({
        where: { memberId: ids.members[0]!, packId: otherPack.id },
      });
      await db.member.update({ where: { id: ids.members[0]! }, data: { packId: ids.pack } });
      await db.pack.deleteMany({ where: { id: otherPack.id } });
      await db.kP.deleteMany({ where: { id: otherKp.id } });
    }
  });

  it('distinguishes zeros from no data', async () => {
    const empty = await service.get({ ...june, eventTypeId: ids.types[0]!, mode: 'PVP' });
    expect(empty.overview.totals).toEqual({
      events: 0,
      counted: 0,
      visited: 0,
      checks: 0,
      attendance: null,
      historyStatus: 'KNOWN',
    });
    expect(empty.byMode).toEqual([
      expect.objectContaining({
        mode: 'PVE',
        totals: { events: 0, counted: 0, visited: 0, checks: 0, attendance: null, historyStatus: 'KNOWN' },
      }),
      expect.objectContaining({
        mode: 'PVP',
        totals: { events: 0, counted: 0, visited: 0, checks: 0, attendance: null, historyStatus: 'KNOWN' },
      }),
    ]);
    expect(empty.peak.byWeekday.every((bucket) => bucket.visited === 0)).toBe(true);
    expect(empty.peak.byHour).toHaveLength(24);
    expect(empty.events).toEqual([]);
    // Ноль отметок при положительном знаменателе — 0%, а не «нет данных».
    const noShows = await service.get({ ...june, eventTypeId: ids.types[0]!, packId: ids.pack });
    expect(noShows.events.find((row) => row.id === ids.events[2])!.attendance).toBe(0);
  });
});
