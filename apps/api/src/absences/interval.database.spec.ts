import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AbsencesService, type AbsencesDb } from './absences.service';
import { ParticipationService } from '../events/participation.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Интервалы отсутствий в PostgreSQL', () => {
  let db: PrismaClient;
  let memberId: string;
  let typeId: string;
  let morningId: string;
  let eveningId: string;
  const now = new Date('2026-11-10T15:00:00Z');
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    memberId = (await db.member.create({ data: { nickname: `interval-${randomUUID()}` } })).id;
    typeId = (await db.eventType.create({ data: { name: `interval-${randomUUID()}` } })).id;
    const makeEvent = async (startsAt: Date, endsAt: Date, status: 'FINISHED' | 'PLANNED') =>
      db.event.create({
        data: {
          name: 'Ивент',
          eventTypeId: typeId,
          raidLeadId: memberId,
          mode: 'PVE',
          startsAt,
          endsAt,
          status,
          dkpReward: 10,
        },
      });
    morningId = (
      await makeEvent(
        new Date('2026-11-10T12:00:00Z'),
        new Date('2026-11-10T13:00:00Z'),
        'FINISHED',
      )
    ).id;
    eveningId = (
      await makeEvent(new Date('2026-11-10T20:00:00Z'), new Date('2026-11-10T21:00:00Z'), 'PLANNED')
    ).id;
  });
  afterAll(async () => {
    if (!db) return;
    if (memberId) {
      await db.auditLog.deleteMany({ where: { actorMemberId: memberId } });
      await db.absence.deleteMany({ where: { memberId } });
    }
    if (typeId) {
      await db.event.deleteMany({ where: { eventTypeId: typeId } });
      await db.eventType.delete({ where: { id: typeId } });
    }
    if (memberId) await db.member.delete({ where: { id: memberId } });
    await db.$disconnect();
  });
  it('заявка на день не меняет утро и применяется к вечернему событию', async () => {
    const service = new AbsencesService(
      db as unknown as AbsencesDb,
      { deadlineBeforeStartSec: 180 },
      () => now,
    );
    await service.create(
      memberId,
      {
        dateFrom: '2026-11-10T00:00:00Z',
        dateTo: '2026-11-11T00:00:00Z',
        allDay: true,
        reason: 'Работа',
      },
      { memberId, isAdmin: false, rank: 'MEMBER' },
    );
    const participation = new ParticipationService(db, () => now);
    expect((await participation.get(morningId, memberId)).attending).toBe(true);
    expect((await participation.get(eveningId, memberId)).attending).toBe(false);
    expect(
      await service.markExcusedForFinishedEvent(
        morningId,
        new Date('2026-11-10T12:00:00Z'),
        new Date('2026-11-10T13:00:00Z'),
      ),
    ).toBe(0);
    expect(await db.attendance.count({ where: { eventId: morningId, memberId } })).toBe(0);
  });
});
