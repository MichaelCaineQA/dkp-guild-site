import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUCTION_EVENTS } from './auction-events';
import { AuctionGateway } from './auction.gateway';
import { AuctionSnapshotService, type SnapshotDb } from './auction-snapshot';
import { SocketAccessService } from './socket-access.service';

/**
 * Realtime аукциона (issue #97, план §7): Socket.IO gateway (cookie-сессия,
 * Redis adapter при REDIS_URL) и порт событий AUCTION_EVENTS для сервисов
 * аукциона. Gateway реализует порт: сервисы зависят только от интерфейса.
 *
 * PrismaService не пере-предоставляем: он приходит из глобального PrismaModule.
 * Локальный дубликат создавал второй PrismaClient, который при старте грузит
 * .env в process.env и ломал изолированные тесты конфигурации (discord.spec).
 */
@Module({
  providers: [
    SocketAccessService,
    {
      provide: AuctionSnapshotService,
      useFactory: (prisma: PrismaService) =>
        new AuctionSnapshotService(prisma as unknown as SnapshotDb),
      inject: [PrismaService],
    },
    AuctionGateway,
    { provide: AUCTION_EVENTS, useExisting: AuctionGateway },
  ],
  exports: [AUCTION_EVENTS],
})
export class RealtimeModule {}
