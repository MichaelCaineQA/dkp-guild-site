import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AttendanceStatisticsService } from './attendance-statistics.service';
import type { PrismaService } from '../prisma/prisma.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Статистика посещаемости в PostgreSQL', () => {
  const suffix = randomUUID().slice(0, 8);
  const ids: {
    guild: string;
    kp: string;
    pack: string;
    member: string;
    type: string;
    events: string[];
    absences: string[];
  } = {
    guild: '',
    kp: '',
    pack: '',
    member: '',
    type: '',
    events: [],
    absences: [],
  };
  let db: PrismaClient;
  let service: AttendanceStatisticsService;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new AttendanceStatisticsService(db as PrismaService);

    const old = new Date('2025-01-01T00:00:00Z');
    ids.guild = (
      await db.guild.create({
        data: { name: `attstats-${suffix}`, gameTimeAnchor: old, createdAt: old },
      })
    ).id;
    ids.kp = (
      await db.kP.create({
        data: { name: `attstats-${suffix}`, guildId: ids.guild, createdAt: old },
      })
    ).id;
    ids.pack = (
      await db.pack.create({ data: { name: `attstats-${suffix}`, kpId: ids.kp, createdAt: old } })
    ).id;
    ids.member = (
      await db.member.create({
        data: { nickname: `attstats-${suffix}`, packId: ids.pack, createdAt: old },
      })
    ).id;
    ids.type = (await db.eventType.create({ data: { name: `attstats-${suffix}` } })).id;

    const scenarios = [
      { name: 'missing attendance', status: 'FINISHED' as const },
      { name: 'cancelled event', status: 'CANCELLED' as const },
      { name: 'running event', status: 'RUNNING' as const },
      { name: 'cancelled absence', status: 'FINISHED' as const },
      { name: 'excused absence', status: 'FINISHED' as const },
      { name: 'accepted code', status: 'FINISHED' as const },
      { name: 'manual excused', status: 'FINISHED' as const },
      { name: 'attendance with absence', status: 'FINISHED' as const },
    ];
    for (let index = 0; index < scenarios.length; index++) {
      const scenario = scenarios[index]!;
      const startsAt = new Date(`2026-03-${String(index + 2).padStart(2, '0')}T16:00:00Z`);
      const event = await db.event.create({
        data: {
          name: `attstats-${scenario.name}-${suffix}`,
          eventTypeId: ids.type,
          mode: 'PVE',
          scope: 'GUILD',
          status: scenario.status,
          raidLeadId: ids.member,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
          dkpReward: 0,
        },
      });
      ids.events.push(event.id);
    }

    for (const index of [3, 4, 7]) {
      const eventId = ids.events[index]!;
      const event = await db.event.findUniqueOrThrow({ where: { id: eventId } });
      const absence = await db.absence.create({
        data: {
          eventId,
          memberId: ids.member,
          dateFrom: event.startsAt,
          dateTo: event.endsAt,
          reason: 'database integration fixture',
          status: index === 3 ? 'CANCELLED' : 'ACTIVE',
        },
      });
      ids.absences.push(absence.id);
    }
    await db.attendance.create({
      data: {
        eventId: ids.events[5]!,
        memberId: ids.member,
        checkinStart: 'PASSED',
        checkinEnd: 'PASSED',
      },
    });
    await db.attendance.create({
      data: { eventId: ids.events[6]!, memberId: ids.member, status: 'EXCUSED_ABSENCE' },
    });
    await db.attendance.create({
      data: { eventId: ids.events[7]!, memberId: ids.member, checkinStart: 'MANUAL' },
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.absenceSeen.deleteMany({ where: { absenceId: { in: ids.absences } } });
    await db.absence.deleteMany({ where: { id: { in: ids.absences } } });
    await db.attendance.deleteMany({
      where: { eventId: { in: ids.events }, memberId: ids.member },
    });
    await db.event.deleteMany({ where: { id: { in: ids.events } } });
    await db.memberPackHistory.deleteMany({ where: { memberId: ids.member } });
    await db.packMembershipHistory.deleteMany({ where: { packId: ids.pack } });
    await db.member.deleteMany({ where: { id: ids.member } });
    await db.pack.deleteMany({ where: { id: ids.pack } });
    await db.kP.deleteMany({ where: { id: ids.kp } });
    await db.guild.deleteMany({ where: { id: ids.guild } });
    await db.eventType.deleteMany({ where: { id: ids.type } });
    await db.$disconnect();
  });

  it('counts only finished events and derives absence and accepted-code outcomes', async () => {
    const report = await service.get({
      from: '2026-03-01',
      to: '2026-03-31',
      eventTypeId: ids.type,
      mode: 'PVE',
    });

    expect(report.overview.finishedEvents).toBe(6);
    expect(report.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: ids.events[0],
          status: 'NO_SHOW',
          checks: 0,
          events: 1,
        }),
        expect.objectContaining({
          eventId: ids.events[3],
          status: 'NO_SHOW',
          checks: 0,
          events: 1,
        }),
        expect.objectContaining({
          eventId: ids.events[4],
          status: 'EXCUSED_ABSENCE',
          checks: 0,
          events: 0,
        }),
        expect.objectContaining({
          eventId: ids.events[5],
          status: 'PRESENT',
          checks: 2,
          events: 1,
        }),
        expect.objectContaining({
          eventId: ids.events[6],
          status: 'EXCUSED_ABSENCE',
          checks: 0,
          events: 0,
        }),
        expect.objectContaining({
          eventId: ids.events[7],
          status: 'LEFT_EARLY',
          checks: 1,
          events: 1,
        }),
      ]),
    );
    expect(report.details.map((row) => row.eventId)).not.toEqual(
      expect.arrayContaining([ids.events[1], ids.events[2]]),
    );
    expect(report.overview.totals).toMatchObject({
      checks: 3,
      events: 4,
      percentage: 37.5,
      excused: 2,
      noShow: 2,
      leftEarly: 1,
      historyStatus: 'NO_HISTORICAL_DATA',
    });
    expect(report.members[0]?.totals).toEqual(report.overview.totals);
    expect(report.top[0]?.id).toBe(ids.member);
    expect(JSON.stringify(report)).not.toContain('database integration fixture');
  });

  it('keeps past attendance attributed to the old pack and KP after both move', async () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const otherKp = await db.kP.create({
      data: { name: `attstats-other-${suffix}`, guildId: ids.guild, createdAt },
    });
    const otherPack = await db.pack.create({
      data: { name: `attstats-other-${suffix}`, kpId: otherKp.id, createdAt },
    });
    try {
      await db.memberPackHistory.create({
        data: {
          memberId: ids.member,
          previousPackId: ids.pack,
          packId: ids.pack,
          changedAt: new Date('2025-12-01T00:00:00Z'),
        },
      });
      await db.packMembershipHistory.create({
        data: {
          packId: ids.pack,
          previousKpId: ids.kp,
          kpId: ids.kp,
          changedAt: new Date('2025-12-01T00:00:00Z'),
        },
      });
      const query = {
        from: '2026-03-01',
        to: '2026-03-31',
        kpId: ids.kp,
        packId: ids.pack,
        eventTypeId: ids.type,
        mode: 'PVE',
      };
      const before = await service.get(query);
      await db.$transaction([
        db.member.update({ where: { id: ids.member }, data: { packId: otherPack.id } }),
        db.memberPackHistory.create({
          data: {
            memberId: ids.member,
            previousPackId: ids.pack,
            packId: otherPack.id,
            changedAt: new Date('2026-04-01T00:00:00Z'),
          },
        }),
        db.pack.update({ where: { id: ids.pack }, data: { kpId: otherKp.id } }),
        db.packMembershipHistory.create({
          data: {
            packId: ids.pack,
            previousKpId: ids.kp,
            kpId: otherKp.id,
            changedAt: new Date('2026-04-01T00:00:00Z'),
          },
        }),
      ]);
      const after = await service.get(query);
      expect(after.details).toEqual(before.details);
      expect(after.overview.totals).toEqual(before.overview.totals);
      expect(after.details[0]).toMatchObject({ packId: ids.pack, kpId: ids.kp });
      expect((await service.get({ ...query, mode: 'PVP' })).details).toEqual([]);
    } finally {
      await db.memberPackHistory.deleteMany({ where: { memberId: ids.member } });
      await db.packMembershipHistory.deleteMany({ where: { packId: ids.pack } });
      await db.member.update({ where: { id: ids.member }, data: { packId: ids.pack } });
      await db.pack.update({ where: { id: ids.pack }, data: { kpId: ids.kp } });
      await db.pack.delete({ where: { id: otherPack.id } });
      await db.kP.delete({ where: { id: otherKp.id } });
    }
  });
});
