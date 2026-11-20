import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { StatisticsService } from './statistics.service';
import type { PrismaService } from '../prisma/prisma.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Историческая статистика в PostgreSQL', () => {
  const suffix = randomUUID().slice(0, 8);
  const ids = {
    guild: '',
    oldKp: '',
    newKp: '',
    pack: '',
    newPack: '',
    member: '',
    type: '',
    event: '',
    item: '',
    drop: '',
  };
  let db: PrismaClient;
  let service: StatisticsService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new StatisticsService(db as PrismaService);
    const createdAt = new Date('2025-01-01T00:00:00Z');
    ids.guild = (
      await db.guild.create({
        data: { name: `stats-${suffix}`, gameTimeAnchor: createdAt, createdAt },
      })
    ).id;
    ids.oldKp = (
      await db.kP.create({ data: { name: `old-${suffix}`, guildId: ids.guild, createdAt } })
    ).id;
    ids.newKp = (
      await db.kP.create({ data: { name: `new-${suffix}`, guildId: ids.guild, createdAt } })
    ).id;
    ids.pack = (
      await db.pack.create({ data: { name: `pack-${suffix}`, kpId: ids.oldKp, createdAt } })
    ).id;
    ids.newPack = (
      await db.pack.create({ data: { name: `other-${suffix}`, kpId: ids.newKp, createdAt } })
    ).id;
    ids.member = (
      await db.member.create({ data: { nickname: `stats-${suffix}`, packId: ids.pack, createdAt } })
    ).id;
    ids.type = (await db.eventType.create({ data: { name: `stats-${suffix}` } })).id;
    ids.event = (
      await db.event.create({
        data: {
          name: 'stats',
          eventTypeId: ids.type,
          mode: 'PVE',
          scope: 'KP',
          kpId: ids.oldKp,
          raidLeadId: ids.member,
          startsAt: new Date('2026-01-05T12:00:00Z'),
          endsAt: new Date('2026-01-05T13:00:00Z'),
          dkpReward: 10,
        },
      })
    ).id;
    ids.item = (
      await db.item.create({ data: { name: `stats-${suffix}`, targetRoles: ['ALL'] } })
    ).id;
    ids.drop = (
      await db.lootDrop.create({
        data: { eventId: ids.event, itemId: ids.item, createdAt: new Date('2026-02-04T12:00:00Z') },
      })
    ).id;
    await db.dkpEntry.create({
      data: {
        memberId: ids.member,
        type: 'MANUAL_EARN',
        amount: 7,
        eventId: ids.event,
        createdAt: new Date('2026-02-04T12:00:00Z'),
      },
    });
    await db.dkpEntry.create({
      data: {
        memberId: ids.member,
        type: 'MANUAL_EARN',
        amount: 3,
        createdAt: new Date('2026-02-04T12:00:00Z'),
      },
    });
  });
  afterAll(async () => {
    if (!db) return;
    await db.dkpEntry.deleteMany({ where: { memberId: ids.member } });
    await db.lootDrop.deleteMany({ where: { id: ids.drop } });
    await db.event.deleteMany({ where: { id: ids.event } });
    await db.memberPackHistory.deleteMany({ where: { memberId: ids.member } });
    await db.packMembershipHistory.deleteMany({ where: { packId: ids.pack } });
    await db.member.deleteMany({ where: { id: ids.member } });
    await db.pack.deleteMany({ where: { id: { in: [ids.pack, ids.newPack] } } });
    await db.kP.deleteMany({ where: { id: { in: [ids.oldKp, ids.newKp] } } });
    await db.guild.deleteMany({ where: { id: ids.guild } });
    await db.eventType.deleteMany({ where: { id: ids.type } });
    await db.item.deleteMany({ where: { id: ids.item } });
    await db.$disconnect();
  });

  it('preserves event membership after moving the pack and keeps missing attendance', async () => {
    const query = {
      from: '2026-01-05',
      to: '2026-01-05',
      kpId: ids.oldKp,
      packId: ids.pack,
      eventTypeId: ids.type,
      mode: 'PVE',
    };
    const before = await service.get(query);
    await db.$transaction([
      db.pack.update({ where: { id: ids.pack }, data: { kpId: ids.newKp } }),
      db.packMembershipHistory.create({
        data: {
          packId: ids.pack,
          previousKpId: ids.oldKp,
          kpId: ids.newKp,
          changedAt: new Date('2026-02-01T00:00:00Z'),
        },
      }),
      db.member.update({ where: { id: ids.member }, data: { packId: ids.newPack } }),
      db.memberPackHistory.create({
        data: {
          memberId: ids.member,
          previousPackId: ids.pack,
          packId: ids.newPack,
          changedAt: new Date('2026-02-02T00:00:00Z'),
        },
      }),
    ]);
    const after = await service.get(query);
    expect(before.events[0]?.members).toEqual([
      expect.objectContaining({ memberId: ids.member, teamStatus: 'NO_HISTORICAL_DATA' }),
    ]);
    expect(after.events[0]?.members).toEqual([
      expect.objectContaining({
        memberId: ids.member,
        kpId: ids.oldKp,
        attendanceStatus: null,
        membershipStatus: 'NO_HISTORICAL_DATA',
      }),
    ]);
    expect((await service.get({ ...query, mode: 'PVP' })).events).toEqual([]);
  });

  it('rejects unknown and incompatible filter identifiers', async () => {
    await expect(service.get({ kpId: 'missing' })).rejects.toThrow('Неизвестный фильтр');
    await expect(service.get({ kpId: ids.oldKp, packId: ids.newPack })).rejects.toThrow(
      'Пак не принадлежит выбранной КП',
    );
  });

  it('selects facts by fact date and keeps eventless operations separate', async () => {
    const report = await service.get({
      from: '2026-02-04',
      to: '2026-02-04',
      eventTypeId: ids.type,
      mode: 'PVE',
      kpId: ids.oldKp,
      packId: ids.pack,
    });
    expect(report.events).toEqual([]);
    expect(report.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'DKP', amount: 7, kpId: ids.oldKp, eventId: ids.event }),
        expect.objectContaining({ kind: 'DROP', itemId: ids.item, eventId: ids.event }),
      ]),
    );
    expect(report.factsWithoutEvent).toEqual([
      expect.objectContaining({ kind: 'DKP', amount: 3, eventId: null, kpId: null }),
    ]);
  });

  it('filterOptions перечисляет пак в текущей и исторической КП (#250)', async () => {
    // Первый тест уже перевёл pack из oldKp в newKp с записью истории.
    const options = await service.filterOptions();
    const packIds = (kpId: string) =>
      options.kps.find((kp) => kp.id === kpId)?.packs.map((pack) => pack.id) ?? [];
    // Прежняя связка выбираема: пак остаётся в списке старой КП и входит в новую.
    expect(packIds(ids.oldKp)).toContain(ids.pack);
    expect(packIds(ids.newKp)).toContain(ids.pack);
    expect(packIds(ids.newKp)).toContain(ids.newPack);
    expect(packIds(ids.oldKp)).not.toContain(ids.newPack);
  });
});
