import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuctionsService, type AuctionsDb } from './auctions.service';
import { MembersService, type MembersDb } from '../members/members.service';
import { BidsService, type BidsDb } from '../bids/bids.service';
import { ProfilesService, type ProfilesDb } from '../profiles/profiles.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Снимки и атомарность аукциона в PostgreSQL', () => {
  let db: PrismaClient;
  let memberId: string;
  let itemId: string;
  const actor = { memberId: null, isAdmin: true, userId: 'admin' };
  const input = () => ({
    itemId,
    startPrice: 100,
    step: 1,
    timerKind: 'OPENING',
    durationValue: 14,
    durationUnit: 'DAYS',
    antiSnipeSec: 0,
  });
  const failingDb = () => ({
    $transaction: (
      work: (tx: unknown) => Promise<unknown>,
      options: { isolationLevel: 'Serializable' },
    ) =>
      db.$transaction(
        (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                return key === 'auditLog'
                  ? {
                      create: async () => {
                        throw new Error('audit unavailable');
                      },
                    }
                  : Reflect.get(target, key);
              },
            }),
          ),
        options,
      ),
  });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    memberId = (
      await db.member.create({ data: { nickname: `atomic-${randomUUID()}`, combatRole: 'DPS' } })
    ).id;
    itemId = (
      await db.item.create({ data: { name: `atomic-${randomUUID()}`, targetRoles: ['DPS'] } })
    ).id;
    await db.member.update({ where: { id: memberId }, data: { preferredItemId: itemId } });
    await db.dkpEntry.create({ data: { memberId, amount: 10000, type: 'MANUAL_EARN' } });
  });
  afterAll(async () => {
    if (!db) return;
    const drops = await db.lootDrop.findMany({ where: { itemId } });
    const lots = await db.auction.findMany({
      where: { lootDropId: { in: drops.map((d) => d.id) } },
    });
    await db.auditLog.deleteMany({
      where: { entityId: { in: [memberId, ...lots.map((l) => l.id)] } },
    });
    await db.bid.deleteMany({ where: { auctionId: { in: lots.map((l) => l.id) } } });
    await db.dkpEntry.deleteMany({ where: { memberId } });
    await db.auction.deleteMany({ where: { id: { in: lots.map((l) => l.id) } } });
    await db.lootDrop.deleteMany({ where: { itemId } });
    await db.member.delete({ where: { id: memberId } });
    await db.item.delete({ where: { id: itemId } });
    await db.$disconnect();
  });
  it('сбой аудита откатывает дроп и лот и не публикует событие', async () => {
    const emitted = jest.fn();
    const service = new AuctionsService(
      failingDb() as unknown as AuctionsDb,
      { lotCreated: emitted } as never,
    );
    await expect(service.createLot(input(), actor)).rejects.toThrow('audit unavailable');
    expect(await db.lootDrop.count({ where: { itemId } })).toBe(0);
    expect(emitted).not.toHaveBeenCalled();
  });
  it('сбой аудита откатывает обычную смену ранга', async () => {
    await expect(
      new MembersService(failingDb() as unknown as MembersDb).changeRank(
        memberId,
        { rank: 'OFFICER', comment: 'Повышение участника' },
        actor,
      ),
    ).rejects.toThrow('audit unavailable');
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).rank).toBe('MEMBER');
  });
  it('две смены роли и предпочтения с продлением лота сохраняют исходную цену', async () => {
    const lot = await new AuctionsService(db as unknown as AuctionsDb).createLot(input(), actor);
    const profiles = new ProfilesService(db as unknown as ProfilesDb, () => new Date('2027-01-01'));
    await profiles.updateOwn(
      memberId,
      {
        combatRole: 'HEALER',
        weapons: ['STAFF', 'WAND'],
        preferredItemId: null,
        comment: 'Первая смена',
      },
      { memberId, rank: 'MEMBER' },
    );
    const later = new ProfilesService(db as unknown as ProfilesDb, () => new Date('2027-02-01'));
    await later.updateOwn(
      memberId,
      {
        combatRole: 'TANK',
        weapons: ['STAFF', 'WAND'],
        preferredItemId: itemId,
        comment: 'Вторая смена',
      },
      { memberId, rank: 'MEMBER' },
    );
    await db.auction.update({ where: { id: lot.id }, data: { endsAt: new Date('2028-01-01') } });
    const result = await new BidsService(db as unknown as BidsDb).place(
      lot.id,
      { amount: 100 },
      { memberId, isAdmin: false },
    );
    expect(result.bid).toMatchObject({ fullCost: 90, markupPct: 0, discountPct: 10 });
    expect(
      (await new AuctionsService(db as unknown as AuctionsDb).list('OPEN', memberId)).find(
        (row) => row.id === lot.id,
      )?.myPreferred,
    ).toBe(true);
  });
});
