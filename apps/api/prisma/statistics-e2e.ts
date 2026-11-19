import { PrismaClient } from '@prisma/client';

export async function seedStatisticsE2e() {
  const url =
    process.env.DATABASE_URL ?? 'postgresql://dkp:dkp@127.0.0.1:5432/dkp_test?schema=public';
  const { hostname, pathname } = new URL(url);
  if (!['127.0.0.1', 'localhost', 'postgres'].includes(hostname) || !pathname.endsWith('_test')) {
    throw new Error('Фикстуры статистики разрешены только в тестовой БД Playwright');
  }

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const fixture = await db.$transaction(async (tx) => {
      const createdAt = new Date('2024-01-01T00:00:00Z');
      const changedAt = new Date('2025-01-15T00:00:00Z');
      const guild = await tx.guild.findFirstOrThrow();
      const pastKp = await tx.kP.create({
        data: { name: 'КП до перевода', guildId: guild.id, createdAt },
      });
      const currentKp = await tx.kP.create({
        data: { name: 'КП после перевода', guildId: guild.id, createdAt },
      });
      const pastPack = await tx.pack.create({
        data: { name: 'Пак до перевода', kpId: currentKp.id, createdAt },
      });
      const currentPack = await tx.pack.create({
        data: { name: 'Пак после перевода', kpId: currentKp.id, createdAt },
      });
      const player = await tx.member.create({
        data: {
          nickname: 'Игрок после перевода',
          pack: { connect: { id: currentPack.id } },
          createdAt,
          user: { create: { username: 'test-statistics-player', createdAt } },
        },
      });
      await tx.kP.update({ where: { id: currentKp.id }, data: { leaderId: player.id } });
      await tx.pack.update({ where: { id: currentPack.id }, data: { leaderId: player.id } });
      await tx.packMembershipHistory.create({
        data: { packId: pastPack.id, previousKpId: pastKp.id, kpId: currentKp.id, changedAt },
      });
      await tx.memberPackHistory.create({
        data: {
          memberId: player.id,
          previousPackId: pastPack.id,
          packId: currentPack.id,
          changedAt,
        },
      });
      const type = await tx.eventType.create({ data: { name: 'Ивенты приёмки статистики' } });
      const scenarios = [
        { name: 'Старт периода по Москве', start: '2025-01-01T21:00:00Z', mode: 'PVE' },
        { name: 'Ивент второй недели', start: '2025-01-10T20:00:00Z', mode: 'PVE' },
        { name: 'До московской границы', start: '2025-01-01T20:59:59Z', mode: 'PVE' },
        { name: 'Ивент другого режима', start: '2025-01-08T20:00:00Z', mode: 'PVP' },
      ] as const;
      const eventIds: string[] = [];
      for (const { name, start, mode } of scenarios) {
        const startsAt = new Date(start);
        const event = await tx.event.create({
          data: {
            name,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3600000),
            mode,
            scope: 'PACK',
            packId: pastPack.id,
            eventTypeId: type.id,
            raidLeadId: player.id,
            status: 'FINISHED',
            dkpReward: 0,
          },
        });
        eventIds.push(event.id);
      }
      await tx.attendance.createMany({
        data: [
          {
            eventId: eventIds[0]!,
            memberId: player.id,
            checkinStart: 'PASSED',
            checkinEnd: 'MANUAL',
          },
          { eventId: eventIds[1]!, memberId: player.id, checkinStart: 'PASSED' },
        ],
      });
      return { pastKp, currentKp, pastPack, currentPack, player, type, eventIds };
    });

    return {
      ...fixture,
      async cleanup() {
        const { pastPack, currentPack, pastKp, currentKp, player, type, eventIds } = fixture;
        try {
          await db.$transaction([
            db.attendance.deleteMany({ where: { eventId: { in: eventIds } } }),
            db.event.deleteMany({ where: { id: { in: eventIds } } }),
            db.memberPackHistory.deleteMany({ where: { memberId: player.id } }),
            db.packMembershipHistory.deleteMany({ where: { packId: pastPack.id } }),
            db.member.delete({ where: { id: player.id } }),
            db.user.delete({ where: { id: player.userId! } }),
            db.pack.deleteMany({ where: { id: { in: [pastPack.id, currentPack.id] } } }),
            db.kP.deleteMany({ where: { id: { in: [pastKp.id, currentKp.id] } } }),
            db.eventType.delete({ where: { id: type.id } }),
          ]);
        } finally {
          await db.$disconnect();
        }
      },
    };
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
}
