import type { Server, Socket } from 'socket.io';
import { AUCTION_SOCKET_EVENTS, type AuctionLiveState } from '@dkp/shared';
import { AuctionGateway, AUCTIONS_ROOM, roomOf } from './auction.gateway';
import type { AuctionSnapshotService } from './auction-snapshot';

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
    firstBidAt: null,
    endsAt: null,
    createdAt: '2026-11-10T17:00:00.000Z',
  },
  bids: [],
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
  const makeChain = (rooms: string[]) => ({
    to: (room: string) => makeChain([...rooms, room]),
    emit: (event: string, payload: unknown) => {
      sent.push({ rooms: [...rooms].reverse(), event, payload });
    },
  });
  const server = { to: (room: string) => makeChain([room]) } as unknown as Server;
  return { server, sent };
}

function makeGateway(state: AuctionLiveState | null, server: Server) {
  const snapshots = {
    liveState: jest.fn(async () => state),
  } as unknown as AuctionSnapshotService;
  const gateway = new AuctionGateway(snapshots);
  gateway.server = server;
  return { gateway, snapshots };
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
      const member = makeClient();
      readSession.mockResolvedValue({ memberId: null, isAdmin: true });

      await gateway.handleConnection(admin.socket);
      await gateway.handleConnection(member.socket);

      expect(admin.disconnect).not.toHaveBeenCalled();
      expect(admin.join).toHaveBeenCalledWith(AUCTIONS_ROOM);
    });
  });

  describe('подписка на лот', () => {
    it('возвращает полный срез и включает в комнату лота', async () => {
      const { server } = makeServer();
      const { gateway } = makeGateway(STATE, server);
      const client = makeClient();

      const ack = await gateway.handleJoin(client.socket, { auctionId: 'a-1' });

      expect(client.join).toHaveBeenCalledWith(roomOf('a-1'));
      expect(ack).toEqual({ event: AUCTION_SOCKET_EVENTS.state, data: STATE });
    });

    it('неизвестный лот — ошибка без входа в комнату', async () => {
      const { server } = makeServer();
      const { gateway } = makeGateway(null, server);
      const client = makeClient();

      const ack = await gateway.handleJoin(client.socket, { auctionId: 'a-x' });

      expect(ack).toEqual({ event: 'auction:error', data: 'Лот не найден' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('мусорный идентификатор отклоняется', async () => {
      const { server } = makeServer();
      const { gateway } = makeGateway(STATE, server);
      const ack = await gateway.handleJoin(makeClient().socket, '../../../etc');
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
  });
});
