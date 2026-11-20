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
      // Различимые данные срезов приёмки (#263): второй тип ивента со своим
      // участием, два выпавших предмета и начисление 42 ДКП на ивенте первого
      // типа — баланс игрока виден даже без совпавших движений (#264).
      const secondType = await tx.eventType.create({ data: { name: 'Второй тип приёмки' } });
      const type2Event = await tx.event.create({
        data: {
          name: 'Ивент второго типа',
          startsAt: new Date('2025-01-03T20:00:00Z'),
          endsAt: new Date('2025-01-03T21:00:00Z'),
          mode: 'PVE',
          scope: 'PACK',
          packId: pastPack.id,
          eventTypeId: secondType.id,
          raidLeadId: player.id,
          status: 'FINISHED',
          dkpReward: 0,
        },
      });
      eventIds.push(type2Event.id);
      await tx.attendance.create({
        data: { eventId: type2Event.id, memberId: player.id, checkinStart: 'PASSED' },
      });
      const slicedItem = await tx.item.create({ data: { name: 'Предмет среза' } });
      const outsideItem = await tx.item.create({ data: { name: 'Предмет вне среза' } });
      await tx.lootDrop.createMany({
        data: [
          {
            itemId: slicedItem.id,
            eventId: eventIds[0]!,
            createdAt: new Date('2025-01-02T20:00:00Z'),
          },
          {
            itemId: outsideItem.id,
            eventId: eventIds[1]!,
            createdAt: new Date('2025-01-10T21:00:00Z'),
          },
        ],
      });
      await tx.dkpEntry.create({
        data: {
          memberId: player.id,
          type: 'CHECKIN_EARN',
          amount: 42,
          eventId: eventIds[0]!,
          createdAt: new Date('2025-01-02T20:00:00Z'),
        },
      });
      return {
        pastKp,
        currentKp,
        pastPack,
        currentPack,
        player,
        type,
        secondType,
        slicedItem,
        outsideItem,
        eventIds,
      };
    });

    return {
      ...fixture,
      async cleanup() {
        const {
          pastPack,
          currentPack,
          pastKp,
          currentKp,
          player,
          type,
          secondType,
          slicedItem,
          outsideItem,
          eventIds,
        } = fixture;
        try {
          await db.$transaction([
            db.attendance.deleteMany({ where: { eventId: { in: eventIds } } }),
            db.dkpEntry.deleteMany({ where: { memberId: player.id } }),
            db.lootDrop.deleteMany({
              where: { itemId: { in: [slicedItem.id, outsideItem.id] } },
            }),
            db.event.deleteMany({ where: { id: { in: eventIds } } }),
            db.item.deleteMany({ where: { id: { in: [slicedItem.id, outsideItem.id] } } }),
            db.memberPackHistory.deleteMany({ where: { memberId: player.id } }),
            db.packMembershipHistory.deleteMany({ where: { packId: pastPack.id } }),
            db.member.delete({ where: { id: player.id } }),
            db.user.delete({ where: { id: player.userId! } }),
            db.pack.deleteMany({ where: { id: { in: [pastPack.id, currentPack.id] } } }),
            db.kP.deleteMany({ where: { id: { in: [pastKp.id, currentKp.id] } } }),
            db.eventType.deleteMany({ where: { id: { in: [type.id, secondType.id] } } }),
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
