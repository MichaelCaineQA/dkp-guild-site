import type { PrismaClient } from '@prisma/client';
import { ParticipationService } from './participation.service';

describe('Состав события', () => {
  const event = {
    startsAt: new Date('2026-11-09T17:00:00Z'),
    endsAt: new Date('2026-11-09T18:00:00Z'),
    scope: 'PACK',
    kpId: null,
    packId: 'p',
  };
  const findMany = jest.fn();
  const db = {
    event: { findUnique: jest.fn(async () => event) },
    member: { findMany },
    absence: {
      findMany: jest.fn(async () => [
        {
          memberId: 'a',
          eventId: 'e',
          dateFrom: event.startsAt,
          dateTo: event.endsAt,
          eligibleFrom: null,
        },
      ]),
    },
  };
  const service = new ParticipationService(db as unknown as PrismaClient);
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([
      {
        id: 'a',
        nickname: 'А',
        rank: 'MEMBER',
        weapons: [],
        combatRole: null,
        packId: 'p',
        pack: { name: 'Пак', kpId: 'k', kp: { name: 'КП' } },
        gsRecords: [{ value: 3000 }],
      },
      {
        id: 'b',
        nickname: 'Б',
        rank: 'MEMBER',
        weapons: [],
        combatRole: null,
        packId: 'other',
        pack: null,
        gsRecords: [],
      },
    ]);
  });
  it('показывает только приглашённых и учитывает отсутствие', async () => {
    const rows = await service.roster('e', true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'a', attending: false, gearScore: 3000, kpName: 'КП' });
  });
  it('не запрашивает и не раскрывает GS без права', async () => {
    const rows = await service.roster('e', false);
    expect(findMany.mock.calls[0][0].select.gsRecords).toBe(false);
    expect(rows[0]!.gearScore).toBeNull();
  });
});
