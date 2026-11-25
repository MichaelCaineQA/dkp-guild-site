import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { EventsService, type EventsDb } from './events.service';
import { ParticipationService } from './participation.service';
import { WeekService } from './week.service';
import { CheckInService, type CheckInDb } from '../checkin/checkin.service';
import { attachCheckInLaunch } from '../checkin/checkin.module';
import { AbsencesService, type AbsencesDb } from '../absences/absences.service';
import { ConductService, type ConductDb } from '../conduct/conduct.service';
import { OrgService } from '../org/org.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from '../auth/session.types';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Состав ивента: перевод после создания в PostgreSQL', () => {
  let db: PrismaClient;
  let events: EventsService;
  let org: OrgService;
  let kpId: string;
  let otherKpId: string;
  let packId: string;
  let otherPackId: string;
  let incoming: string;
  let outgoing: string;
  let typeId: string;
  const start = new Date('2027-06-01T17:00:00Z');
  const admin = { memberId: null, isAdmin: true, rank: null };
  const session: SessionUser = { ...admin, userId: 'admin:test', username: 'test', blocked: false };
  const input = () => ({
    name: 'Сбор пака',
    eventTypeId: typeId,
    raidLeadId: outgoing,
    startsAt: start,
    endsAt: new Date(+start + 3600000),
    mode: 'PVE',
    dkpReward: 10,
    scope: 'PACK',
    kpId,
    packId,
  });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    events = new EventsService(db as unknown as EventsDb);
    org = new OrgService(db as PrismaService);
    const suffix = randomUUID();
    const guild = await db.guild.findFirstOrThrow();
    kpId = (await db.kP.create({ data: { name: 'scope-kp-' + suffix, guildId: guild.id } })).id;
    otherKpId = (await db.kP.create({ data: { name: 'scope-other-' + suffix, guildId: guild.id } }))
      .id;
    packId = (await db.pack.create({ data: { name: 'Приглашённый пак', kpId } })).id;
    otherPackId = (await db.pack.create({ data: { name: 'Другой пак', kpId: otherKpId } })).id;
    outgoing = (await db.member.create({ data: { nickname: 'scope-out-' + suffix, packId } })).id;
    incoming = (
      await db.member.create({ data: { nickname: 'scope-in-' + suffix, packId: otherPackId } })
    ).id;
    typeId = (await db.eventType.create({ data: { name: 'scope-' + suffix } })).id;
  });
  afterAll(async () => {
    if (!db) return;
    const members = [incoming, outgoing].filter(Boolean);
    const eventIds = typeId
      ? (await db.event.findMany({ where: { eventTypeId: typeId }, select: { id: true } })).map(
          (e) => e.id,
        )
      : [];
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { actorMemberId: { in: members } },
          { entityId: { in: [...members, ...eventIds, packId].filter(Boolean) } },
        ],
      },
    });
    await db.dkpEntry.deleteMany({ where: { memberId: { in: members } } });
    await db.absence.deleteMany({ where: { memberId: { in: members } } });
    await db.attendance.deleteMany({ where: { memberId: { in: members } } });
    await db.checkInCode.deleteMany({ where: { eventId: { in: eventIds } } });
    await db.eventSummaryBatch.deleteMany({ where: { eventId: { in: eventIds } } });
    if (typeId) {
      await db.event.deleteMany({ where: { eventTypeId: typeId } });
      await db.eventType.delete({ where: { id: typeId } });
    }
    await db.memberPackHistory.deleteMany({ where: { memberId: { in: members } } });
    await db.packMembershipHistory.deleteMany({
      where: { packId: { in: [packId, otherPackId].filter(Boolean) } },
    });
    await db.member.deleteMany({ where: { id: { in: members } } });
    await db.pack.deleteMany({ where: { id: { in: [packId, otherPackId].filter(Boolean) } } });
    await db.kP.deleteMany({ where: { id: { in: [kpId, otherKpId].filter(Boolean) } } });
    await db.$disconnect();
  });

  it('перечитывает состав для участия, N/M, отсутствий, кодов и ручных итогов', async () => {
    const { id } = await events.create(input(), admin);
    const participation = new ParticipationService(db, () => new Date(+start - 3600000));
    await participation.update(id, outgoing, { attending: false, reason: 'Не смогу' });
    await org.moveMember(outgoing, { packId: otherPackId }, session);
    await org.moveMember(incoming, { packId }, session);

    expect(await participation.get(id, incoming)).toMatchObject({
      invited: true,
      canDecline: true,
    });
    expect(await participation.get(id, outgoing)).toMatchObject({
      invited: false,
      canDecline: false,
    });
    await expect(participation.update(id, outgoing, { attending: false })).rejects.toThrow(
      ForbiddenException,
    );
    await participation.update(id, incoming, { attending: false, reason: 'Работа' });
    const week = await new WeekService(db).list(
      { from: start, to: new Date(+start + 86400000), eventTypeId: typeId },
      incoming,
    );
    expect(week.find((e) => e.id === id)).toMatchObject({
      invitedCount: 1,
      attendingCount: 0,
      scopeName: 'Приглашённый пак',
    });
    expect((await participation.roster(id, false)).map((m) => m.id)).toEqual([incoming]);
    const absences = new AbsencesService(db as unknown as AbsencesDb, {
      deadlineBeforeStartSec: 180,
    });
    expect((await absences.forEventId(id, admin)).map((a) => a.memberId)).toEqual([incoming]);
    expect(await absences.markExcusedForFinishedEvent(id, start)).toBe(1);
    expect(
      await db.attendance.findUnique({
        where: { eventId_memberId: { eventId: id, memberId: outgoing } },
      }),
    ).toBeNull();

    // Код открывается кнопкой «Начать ивент» (решение 23), за минуту до планового начала.
    events = new EventsService(db as unknown as EventsDb, () => new Date(+start - 60000));
    attachCheckInLaunch(events, 'ab'.repeat(32));
    await events.changeStatus(id, { status: 'RUNNING' }, admin);
    const checkin = new CheckInService(
      db as unknown as CheckInDb,
      { startSharePct: 50, endSharePct: 50 },
      () => new Date(+start - 60000),
      'ab'.repeat(32),
    );
    await expect(checkin.playerView(id, outgoing)).rejects.toThrow(ForbiddenException);
    const code = await checkin.raidLeadView(id, admin, null);
    await expect(checkin.submit(id, outgoing, { code: code.code })).rejects.toThrow(
      ForbiddenException,
    );
    expect(await checkin.submit(id, incoming, { code: code.code })).toEqual({ result: 'PASSED' });
    expect(
      await db.dkpEntry.findMany({
        where: { eventId: id },
        select: { memberId: true, amount: true },
      }),
    ).toEqual([{ memberId: incoming, amount: 5 }]);

    const conduct = new ConductService(db as unknown as ConductDb, {
      startSharePct: 50,
      endSharePct: 50,
    });
    expect((await conduct.checklistForActor(id, admin, null)).map((m) => m.memberId)).toEqual([
      incoming,
    ]);
    await expect(
      conduct.manualCheckIn(
        id,
        { memberId: outgoing, phase: 'END', comment: 'Проверка' },
        admin,
        null,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      conduct.setAttendance(
        id,
        { memberId: outgoing, status: 'PRESENT', comment: 'Проверка' },
        admin,
        null,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      conduct.manualDkp(
        id,
        { memberId: outgoing, type: 'MANUAL_EARN', amount: 1, comment: 'Проверка' },
        admin,
        null,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      conduct.applySummary(
        id,
        {
          requestId: randomUUID(),
          actions: [{ kind: 'CHECKIN', memberId: outgoing, phase: 'END', comment: 'Проверка' }],
        },
        admin,
        null,
      ),
    ).rejects.toThrow('приглашённый состав');
  });

  it('создаёт и удаляет серию с составом пака', async () => {
    const result = await events.createSeries(
      { ...input(), repeat: 'DAILY', until: new Date(+start + 86400000) },
      admin,
    );
    expect(
      await db.event.findMany({
        where: { seriesId: result.seriesId },
        select: { scope: true, kpId: true, packId: true },
      }),
    ).toEqual([
      { scope: 'PACK', kpId, packId },
      { scope: 'PACK', kpId, packId },
    ]);
    expect(await events.deleteSeries(result.seriesId, admin)).toEqual({ deleted: 2 });
    await db.auditLog.deleteMany({ where: { entityId: result.seriesId } });
  });

  it('отклоняет несогласованную пару КП/пак', async () => {
    await expect(events.create({ ...input(), kpId: otherKpId }, admin)).rejects.toThrow(
      'Пак не принадлежит',
    );
  });

  it('при переносе пака сохраняет согласованную КП его ивентов и обновляет приглашённых КП', async () => {
    const packed = await events.create(input(), admin);
    const kpEvent = await events.create({ ...input(), scope: 'KP', packId: null }, admin);
    await org.movePack(packId, { kpId: otherKpId }, session);
    expect(await events.getOne(packed.id)).toMatchObject({
      scope: 'PACK',
      kpId: otherKpId,
      packId,
    });
    const participation = new ParticipationService(db);
    expect(await participation.get(kpEvent.id, incoming)).toMatchObject({ invited: false });
    expect(await participation.get(packed.id, incoming)).toMatchObject({ invited: true });
  });
});
