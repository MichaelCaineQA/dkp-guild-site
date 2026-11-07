import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LinkRequestService, type LinkRequestDb } from './link-request.service';
const file = '11111111-1111-4111-8111-111111111111';
const input = {
  nickname: 'Игрок',
  combatRole: 'HEALER',
  weapons: ['STAFF', 'WAND'],
  gearScore: 1,
  screenshotIds: [file],
};
interface RequestRow {
  id: string;
  userId: string;
  nickname: string;
  status: string;
  combatRole?: string;
  weapons?: string[];
  gearScore?: number | null;
  screenshotIds?: string[];
}
interface State {
  requests: RequestRow[];
  members: Array<{ id: string; userId: string | null; nickname: string; rank?: string }>;
  gs: unknown[];
  audits: Array<{ action: string; comment: string }>;
}
function fixture() {
  let state: State = { requests: [], members: [], gs: [], audits: [] };
  let failAudit = false;
  let ownFiles = true;
  const txFor = (draft: State) => ({
    user: {
      findUnique: jest.fn(async () => ({
        id: 'u',
        discordId: 'discord',
        member: draft.members.find((m) => m.userId === 'u') ?? null,
      })),
    },
    screenshot: { count: jest.fn(async () => (ownFiles ? 1 : 0)) },
    member: {
      findUnique: jest.fn(
        async ({ where }: { where: { nickname: string } }) =>
          draft.members.find((m) => m.nickname === where.nickname) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: { nickname: string; userId: string } }) => {
        const row = { id: 'm', ...data };
        draft.members.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        const row = draft.members.find((m) => m.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    memberLinkRequest: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          draft.requests.find((r) => r.id === where.id) ?? null,
      ),
      findFirst: jest.fn(
        async () => [...draft.requests].reverse().find((r) => r.status === 'PENDING') ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        const row = draft.requests.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      upsert: jest.fn(async ({ create }: { create: object }) => {
        const row = { id: 'r', status: 'PENDING', ...create } as RequestRow;
        draft.requests.push(row);
        return row;
      }),
    },
    gearScoreRecord: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        draft.gs.push(data);
        return data;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: State['audits'][number] }) => {
        if (failAudit) throw new Error('audit unavailable');
        draft.audits.push(data);
        return data;
      }),
    },
  });
  const transaction = jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
    const draft = structuredClone(state);
    const result = await work(txFor(draft));
    state = draft;
    return result;
  });
  const service = new LinkRequestService({ $transaction: transaction } as unknown as LinkRequestDb);
  return {
    service,
    transaction,
    state: () => state,
    failAudit: () => {
      failAudit = true;
    },
    foreignFiles: () => {
      ownFiles = false;
    },
  };
}
describe('Анкета вступления', () => {
  it('редактирует одну ожидающую анкету даже при смене ника; аудит без значения GS', async () => {
    const f = fixture();
    await f.service.create('u', input);
    await f.service.create('u', { ...input, nickname: 'НовыйНик', gearScore: 1234 });
    expect(f.state().requests).toHaveLength(1);
    expect(f.state().requests[0]).toMatchObject({
      nickname: 'НовыйНик',
      gearScore: 1234,
      status: 'PENDING',
    });
    expect(f.state().audits.map((a) => a.action)).toEqual([
      'ONBOARDING_SUBMIT',
      'ONBOARDING_UPDATE',
    ]);
    expect(JSON.stringify(f.state().audits)).not.toContain('1234');
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('переносит анкету и GS в новый профиль MEMBER при одобрении и повторно не принимает', async () => {
    const f = fixture();
    await f.service.create('u', input);
    await f.service.approve('r', 'head');
    expect(f.state().members[0]).toMatchObject({
      nickname: input.nickname,
      userId: 'u',
      weapons: input.weapons,
    });
    expect(f.state().gs).toEqual([{ memberId: 'm', value: 1, screenshotIds: [file] }]);
    expect(f.state().requests[0].status).toBe('APPROVED');
    expect(f.state().audits.at(-1)).toMatchObject({
      action: 'LINK_REQUEST_APPROVE',
      actorMemberId: 'head',
    });
    await expect(f.service.approve('r')).rejects.toThrow();
    expect(f.state().gs).toHaveLength(1);
  });
  it('при сбое аудита откатывает приём, профиль и GS', async () => {
    const f = fixture();
    await f.service.create('u', input);
    f.failAudit();
    await expect(f.service.approve('r')).rejects.toThrow('audit unavailable');
    expect(f.state().requests[0].status).toBe('PENDING');
    expect(f.state().members).toEqual([]);
    expect(f.state().gs).toEqual([]);
  });
  it('при сбое аудита не сохраняет изменения анкеты', async () => {
    const f = fixture();
    await f.service.create('u', input);
    f.failAudit();
    await expect(f.service.create('u', { ...input, nickname: 'НовоеИмя' })).rejects.toThrow();
    expect(f.state().requests[0].nickname).toBe(input.nickname);
  });
  it('старую неполную анкету можно обновить, но нельзя принять без GS и скриншота', async () => {
    const f = fixture();
    f.state().requests.push({ id: 'old', userId: 'u', nickname: 'Игрок', status: 'PENDING' });
    await expect(f.service.approve('old')).rejects.toThrow(ConflictException);
    await f.service.create('u', input);
    await f.service.approve('old');
    expect(f.state().members).toHaveLength(1);
  });
  it('не использует чужие файлы ни при подаче, ни при одобрении', async () => {
    const f = fixture();
    await f.service.create('u', input);
    f.foreignFiles();
    await expect(f.service.create('u', input)).rejects.toThrow(BadRequestException);
    await expect(f.service.approve('r')).rejects.toThrow(ConflictException);
    expect(f.state().members).toEqual([]);
  });
  it('привязывает старый непривязанный профиль, сохраняя его ранг', async () => {
    const f = fixture();
    f.state().members.push({ id: 'legacy', userId: null, nickname: 'Игрок', rank: 'OFFICER' });
    await f.service.create('u', input);
    await f.service.approve('r');
    expect(f.state().members).toHaveLength(1);
    expect(f.state().members[0]).toMatchObject({ id: 'legacy', userId: 'u', rank: 'OFFICER' });
  });
  it('занятый ник и уже принятый аккаунт не подают новую анкету', async () => {
    const f = fixture();
    f.state().members.push({ id: 'other', userId: 'other', nickname: 'Игрок' });
    await expect(f.service.create('u', input)).rejects.toThrow(ConflictException);
    f.state().members[0].userId = 'u';
    await expect(f.service.create('u', input)).rejects.toThrow(UnauthorizedException);
  });
  it('проверяет занятый ник ещё раз при одобрении', async () => {
    const f = fixture();
    await f.service.create('u', input);
    f.state().members.push({ id: 'other', userId: 'other', nickname: 'Игрок' });
    await expect(f.service.approve('r')).rejects.toThrow(ConflictException);
    expect(f.state().requests[0].status).toBe('PENDING');
  });
  it('после конфликта сериализации повторяет всю транзакцию', async () => {
    const f = fixture();
    f.transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '6' }),
    );
    await f.service.create('u', input);
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.state().requests).toHaveLength(1);
  });
  it.each([
    { ...input, gearScore: 0 },
    { ...input, gearScore: 1.5 },
    { ...input, screenshotIds: [] },
  ])('неполная анкета не пишет в БД', async (body) => {
    const f = fixture();
    await expect(f.service.create('u', body)).rejects.toThrow(BadRequestException);
    expect(f.transaction).not.toHaveBeenCalled();
  });
});
