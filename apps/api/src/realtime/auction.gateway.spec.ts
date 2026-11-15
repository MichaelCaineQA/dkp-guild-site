import type { Server, Socket } from 'socket.io';
import { AUCTION_SOCKET_EVENTS, type AuctionLiveState, type SessionUser } from '@dkp/shared';
import { AuctionGateway, AUCTIONS_ROOM, roomOf, userRoomOf } from './auction.gateway';
import type { AuctionSnapshotService } from './auction-snapshot';
import { SocketAccessService } from './socket-access.service';

jest.mock('../auth/session', () => ({
  readSessionUser: jest.fn(),
}));

import { readSessionUser } from '../auth/session';

const readSession = readSessionUser as unknown as jest.Mock;

const STATE: AuctionLiveState = {
  lot: {
    id: 'a-1',
    status: 'OPEN',
    startPrice: 100,
    step: 5,
    timerKind: 'FIRST_BID',
    durationSec: 90,
    antiSnipeSec: 30,
    antiSnipeExtendSec: 30,
    noBidTimeoutSec: 120,
    markupPct: 0,
    discountPct: 0,
    firstBidAt: null,
    endsAt: null,
    createdAt: '2026-11-10T17:00:00.000Z',
  },
  bids: [],
  winner: null,
  serverTime: '2026-11-10T17:00:01.000Z',
};

interface FakeClient {
  socket: Socket;
  join: jest.Mock;
  emit: jest.Mock;
  disconnect: jest.Mock;
}

function makeClient(): FakeClient {
  const join = jest.fn(async () => undefined);
  const emit = jest.fn();
  const disconnect = jest.fn();
  const socket = { data: {}, request: {}, join, emit, disconnect } as unknown as Socket;
  return { socket, join, emit, disconnect };
}

/** Сервер с записью комнат и отправленных событий (цепочка .to().to().emit). */
function makeServer() {
  const sent: Array<{ rooms: string[]; event: string; payload: unknown }> = [];
  const disconnected: string[][] = [];
  const makeChain = (rooms: string[]) => ({
    to: (room: string) => makeChain([...rooms, room]),
    emit: (event: string, payload: unknown) => {
      sent.push({ rooms: [...rooms].reverse(), event, payload });
    },
    disconnectSockets: () => {
      disconnected.push([...rooms].reverse());
    },
  });
  const server = {
    to: (room: string) => makeChain([room]),
    in: (room: string) => makeChain([room]),
  } as unknown as Server;
  return { server, sent, disconnected };
}

/** Допуск из БД: по умолчанию пропускает, тесты подменяют ответ. */
function makeAccess(answer?: Promise<SessionUser | null>) {
  const refreshUser = jest.fn(async (user: SessionUser): Promise<SessionUser | null> =>
    answer === undefined ? user : answer,
  );
  return { access: { refreshUser } as unknown as SocketAccessService, refreshUser };
}

function makeGateway(
  state: AuctionLiveState | null,
  server: Server,
  access: SocketAccessService = makeAccess().access,
) {
  const snapshots = {
    liveState: jest.fn(async () => state),
  } as unknown as AuctionSnapshotService;
  const gateway = new AuctionGateway(snapshots, access);
  gateway.server = server;
  return { gateway, snapshots };
}

/** Клиент с уже пройденным handshake (client.data.user заполнен). */
function memberSocket(user: Partial<SessionUser> = {}): FakeClient {
  const client = makeClient();
  client.socket.data.user = {
    userId: 'u-1',
    username: 'warrior',
    memberId: 'm-1',
    rank: 'MEMBER',
    isAdmin: false,
    blocked: false,
    ...user,
  } satisfies SessionUser;
  return client;
}

describe('AuctionGateway (issue #97)', () => {
  beforeEach(() => {
    readSession.mockReset();
    delete process.env.REDIS_URL;
  });

  describe('аутентификация соединения', () => {
    it('без сессии — ошибка и отключение, в комнаты не попадает', async () => {
      const { server } = makeServer();
      const { gateway } = makeGateway(STATE, server);
      const client = makeClient();
      readSession.mockResolvedValue(null);

      await gateway.handleConnection(client.socket);

      expect(client.emit).toHaveBeenCalledWith('auction:error', expect.any(String));
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('резервный админ без Member проходит, как и член гильдии', async () => {
      const { server } = makeServer();
      const { gateway } = makeGateway(STATE, server);
      const admin = makeClient();
      readSession.mockResolvedValue({
        userId: 'admin:root',
        username: 'root',
        memberId: null,
        rank: null,
        isAdmin: true,
        blocked: false,
      } satisfies SessionUser);

      await gateway.handleConnection(admin.socket);

      expect(admin.disconnect).not.toHaveBeenCalled();
      expect(admin.join).toHaveBeenCalledWith(AUCTIONS_ROOM);
      expect(admin.join).toHaveBeenCalledWith(userRoomOf('admin:root'));
    });

    it('сессия не заблокирована, но в БД блокировка — «врата» и disconnect (аудит F02)', async () => {
      const { server } = makeServer();
      const stale: SessionUser = {
        userId: 'u-1',
        username: 'warrior',
        memberId: 'm-1',
        rank: 'MEMBER',
        isAdmin: false,
        blocked: false,
      };
      const { access } = makeAccess(Promise.resolve({ ...stale, blocked: true }));
      const { gateway } = makeGateway(STATE, server, access);
      const client = makeClient();
      readSession.mockResolvedValue(stale);

      await gateway.handleConnection(client.socket);

      expect(client.emit).toHaveBeenCalledWith('auction:error', 'Гильдия закрыла свои врата');
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('членство исчезло (Member нет) — доступ закрыт', async () => {
      const { server } = makeServer();
      const stale: SessionUser = {
        userId: 'u-9',
        username: 'ghost',
        memberId: 'm-9',
        rank: 'MEMBER',
        isAdmin: false,
        blocked: false,
      };
      const { access } = makeAccess(Promise.resolve(null));
      const { gateway } = makeGateway(STATE, server, access);
      const client = makeClient();
      readSession.mockResolvedValue(stale);

      await gateway.handleConnection(client.socket);

      expect(client.emit).toHaveBeenCalledWith('auction:error', 'Гильдия закрыла свои врата');
      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  describe('подписка на лот', () => {
    it('возвращает полный срез и включает в комнату лота', async () => {
      const { server } = makeServer();
      const { gateway, snapshots } = makeGateway(STATE, server);
      const client = memberSocket();

      const ack = await gateway.handleJoin(client.socket, { auctionId: 'a-1' });

      expect(client.join).toHaveBeenCalledWith(roomOf('a-1'));
      expect(ack).toEqual({ event: AUCTION_SOCKET_EVENTS.state, data: STATE });
      // Допуск перечитан из БД именно при подписке (аудит F02)
      expect(snapshots.liveState).toHaveBeenCalledWith('a-1');
    });

    it('без handshake-пользователя подписка невозможна', async () => {
      const { server } = makeServer();
      const { gateway } = makeGateway(STATE, server);
      const ack = await gateway.handleJoin(makeClient().socket, { auctionId: 'a-1' });
      expect(ack).toEqual({ event: 'auction:error', data: 'Соединение не авторизовано' });
    });

    it('блокировка после handshake: подписка отклоняется, сокет закрывается (аудит F02)', async () => {
      const { server } = makeServer();
      const stale = memberSocket();
      const blockedUser: SessionUser = {
        userId: 'u-1',
        username: 'warrior',
        memberId: 'm-1',
        rank: 'MEMBER',
        isAdmin: false,
        blocked: true,
      };
      const { access, refreshUser } = makeAccess(Promise.resolve(blockedUser));
      const { gateway } = makeGateway(STATE, server, access);

      const ack = await gateway.handleJoin(stale.socket, { auctionId: 'a-1' });

      expect(refreshUser).toHaveBeenCalledWith(stale.socket.data.user);
      expect(ack).toEqual({ event: 'auction:error', data: 'Гильдия закрыла свои врата' });
      expect(stale.emit).toHaveBeenCalledWith('auction:error', 'Гильдия закрыла свои врата');
      expect(stale.disconnect).toHaveBeenCalled();
      expect(stale.join).not.toHaveBeenCalled();
    });

    it('неизвестный лот — ошибка без входа в комнату', async () => {
      const { server } = makeServer();
      const { gateway } = makeGateway(null, server);
      const client = memberSocket();

      const ack = await gateway.handleJoin(client.socket, { auctionId: 'a-x' });

      expect(ack).toEqual({ event: 'auction:error', data: 'Лот не найден' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('мусорный идентификатор отклоняется', async () => {
      const { server } = makeServer();
      const { gateway } = makeGateway(STATE, server);
      const ack = await gateway.handleJoin(memberSocket().socket, '../../../etc');
      expect(ack).toEqual({ event: 'auction:error', data: 'Некорректный идентификатор лота' });
    });
  });

  describe('события портa', () => {
    it('ставка уходит только в комнату лота, создание — в общий канал', () => {
      const { server, sent } = makeServer();
      const { gateway } = makeGateway(STATE, server);

      gateway.bidPlaced('a-1', STATE.bids[0] ?? ({ id: 'b-1' } as never), null);
      gateway.lotCreated(STATE.lot);

      expect(sent).toEqual([
        { rooms: [roomOf('a-1')], event: AUCTION_SOCKET_EVENTS.bid, payload: expect.anything() },
        {
          rooms: [AUCTIONS_ROOM],
          event: AUCTION_SOCKET_EVENTS.created,
          payload: expect.anything(),
        },
      ]);
      const [bid] = sent as Array<{ payload: { auctionId: string; endsAt: string | null } }>;
      expect(bid.payload).toMatchObject({ auctionId: 'a-1', endsAt: null });
    });

    it('закрытие шлёт лёгкое событие в комнату лота и канал списка', async () => {
      const { server, sent } = makeServer();
      const { gateway, snapshots } = makeGateway(STATE, server);

      gateway.lotClosed('a-1', null, 'EXPIRED');
      await new Promise((resolve) => setImmediate(resolve)); // fresh-срез читается асинхронно

      expect(sent).toEqual([
        {
          rooms: [AUCTIONS_ROOM, roomOf('a-1')],
          event: AUCTION_SOCKET_EVENTS.closed,
          payload: expect.objectContaining({ auctionId: 'a-1', reason: 'EXPIRED' }),
        },
        {
          rooms: [roomOf('a-1')],
          event: AUCTION_SOCKET_EVENTS.state,
          payload: STATE,
        },
      ]);
      expect(snapshots.liveState).toHaveBeenCalledWith('a-1');
    });

    it('отзыв доступа: комнате пользователя — ошибка и закрытие сокетов (аудит F02)', () => {
      const { server, sent, disconnected } = makeServer();
      const { gateway } = makeGateway(STATE, server);

      gateway.userAccessRevoked('u-2');

      expect(sent).toContainEqual({
        rooms: [userRoomOf('u-2')],
        event: 'auction:error',
        payload: 'Гильдия закрыла свои врата',
      });
      expect(disconnected).toEqual([[userRoomOf('u-2')]]);
    });
  });

  describe('SocketAccessService.refreshUser', () => {
    it('админ — всегда доступен и не заблокирован', async () => {
      const access = new SocketAccessService({} as never);
      const admin: SessionUser = {
        userId: 'admin:root',
        username: 'root',
        memberId: null,
        rank: null,
        isAdmin: true,
        blocked: true, // даже устаревший флаг сессии игнорируется
      };
      await expect(access.refreshUser(admin)).resolves.toMatchObject({
        isAdmin: true,
        blocked: false,
      });
    });

    it('членство перечитывается: blocked и rank свежие; Member нет — null', async () => {
      const findUnique = jest.fn(async ({ where }: { where: { userId: string } }) =>
        where.userId === 'u-1'
          ? { id: 'm-1', rank: 'OFFICER', blockedAt: new Date() }
          : null,
      );
      const access = new SocketAccessService({ member: { findUnique } } as never);
      const user: SessionUser = {
        userId: 'u-1',
        username: 'warrior',
        memberId: 'm-1',
        rank: 'MEMBER',
        isAdmin: false,
        blocked: false,
      };
      await expect(access.refreshUser(user)).resolves.toMatchObject({
        memberId: 'm-1',
        rank: 'OFFICER',
        blocked: true,
      });
      await expect(
        access.refreshUser({ ...user, userId: 'u-x', memberId: null, rank: null }),
      ).resolves.toBeNull();
    });
  });
});
