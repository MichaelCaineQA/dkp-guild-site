import { UnauthorizedException } from '@nestjs/common';
import {
  LinkRequestService,
  type LinkRequestDb,
} from './link-request.service';

interface DbState {
  users: Array<{ id: string; username: string; member: { id: string } | null }>;
  members: Array<{ id: string; nickname: string; userId: string | null }>;
  requests: Array<{
    id: string;
    userId: string;
    nickname: string;
    status: string;
    resolvedAt: Date | null;
  }>;
}

function makeDb(state: DbState): LinkRequestDb {
  return {
    user: {
      findUnique: async ({ where }) => state.users.find((u) => u.id === where.id) ?? null,
    },
    member: {
      findFirst: async ({ where }: { where: { userId?: string; nickname?: string } }) =>
        state.members.find((m) =>
          where.userId ? m.userId === where.userId : m.nickname === where.nickname,
        ) ?? null,
      update: async ({ where, data }) => {
        const member = state.members.find((m) => m.id === where.id)!;
        member.userId = data.userId;
      },
      create: async ({ data }) => {
        const member = {
          id: `member-${state.members.length + 1}`,
          nickname: data.nickname,
          userId: data.userId,
        };
        state.members.push(member);
        return member;
      },
    },
    memberLinkRequest: {
      findUnique: async ({ where }) => state.requests.find((r) => r.id === where.id) ?? null,
      create: async ({ data }) => {
        state.requests.push({
          id: `req-${state.requests.length + 1}`,
          userId: data.userId,
          nickname: data.nickname,
          status: 'PENDING',
          resolvedAt: null,
        });
      },
      update: async ({ where, data }) => {
        const request = state.requests.find((r) => r.id === where.id)!;
        request.status = data.status;
        request.resolvedAt = data.resolvedAt;
      },
      findMany: async ({ where }) =>
        state.requests
          .filter((r) => r.status === where.status)
          .map((r) => ({
            id: r.id,
            nickname: r.nickname,
            createdAt: new Date(),
            user: { username: state.users.find((u) => u.id === r.userId)?.username ?? '' },
          })),
    },
  };
}

function makeState(): DbState {
  return {
    users: [
      { id: 'u1', username: 'linked', member: { id: 'm1' } },
      { id: 'u2', username: 'orphan', member: null },
    ],
    members: [{ id: 'm1', nickname: 'linked', userId: 'u1' }],
    requests: [],
  };
}

describe('LinkRequestService', () => {
  it('непривязанный пользователь подаёт заявку на ник', async () => {
    const state = makeState();
    const service = new LinkRequestService(makeDb(state));

    const result = await service.create('u2', { nickname: 'Игрок' });

    expect(result).toEqual({ ok: true });
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({ userId: 'u2', nickname: 'Игрок', status: 'PENDING' });
  });

  it('уже привязанный аккаунт заявку подать не может', async () => {
    const state = makeState();
    const service = new LinkRequestService(makeDb(state));

    await expect(service.create('u1', { nickname: 'Игрок' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('approve привязывает существующего непривязанного Member по нику', async () => {
    const state = makeState();
    const service = new LinkRequestService(makeDb(state));
    // офицер заранее завёл Member «officer-made» без аккаунта
    state.members.push({ id: 'officer-made', nickname: 'officer-made', userId: null });
    await service.create('u2', { nickname: 'officer-made' });

    await service.approve('req-1');

    expect(state.members.find((m) => m.id === 'officer-made')?.userId).toBe('u2');
    expect(state.requests[0].status).toBe('APPROVED');
  });

  it('approve создаёт нового Member, если такого ника нет', async () => {
    const state = makeState();
    const service = new LinkRequestService(makeDb(state));
    await service.create('u2', { nickname: 'brand-new' });

    await service.approve('req-1');

    expect(state.members).toContainEqual({
      id: 'member-2',
      nickname: 'brand-new',
      userId: 'u2',
    });
  });

  it('занятый другим аккаунтом ник не привязывается', async () => {
    const state = makeState();
    const service = new LinkRequestService(makeDb(state));
    await service.create('u2', { nickname: 'linked' });

    await expect(service.approve('req-1')).rejects.toThrow(UnauthorizedException);
  });

  it('reject закрывает заявку без привязки', async () => {
    const state = makeState();
    const service = new LinkRequestService(makeDb(state));
    await service.create('u2', { nickname: 'Игрок' });

    await service.reject('req-1');

    expect(state.requests[0].status).toBe('REJECTED');
    expect(state.members).toHaveLength(1);
  });
});
