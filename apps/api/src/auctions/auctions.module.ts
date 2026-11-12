import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuctionsController } from './auctions.controller';
import { AuctionsService, type AuctionsDb } from './auctions.service';

/** Список лотов аукциона, виджет «Мой аукцион» (issue #98)
 *  и создание лота вне ивента «хранилище гильдии» (#137). */
@Module({
  imports: [RealtimeModule],
  controllers: [AuctionsController],
  providers: [
    PrismaService,
    {
      provide: AuctionsService,
      useFactory: (prisma: PrismaService, events: AuctionEventsPort) =>
        new AuctionsService(prisma as unknown as AuctionsDb, events),
      inject: [PrismaService, AUCTION_EVENTS],
    },
  ],
  exports: [AuctionsService],
})
export class AuctionsModule {}
