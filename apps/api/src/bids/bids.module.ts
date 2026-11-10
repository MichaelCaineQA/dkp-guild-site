import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import { RealtimeModule } from '../realtime/realtime.module';
import { BidsController } from './bids.controller';
import { BidsService, type BidsDb } from './bids.service';

/** Ставки открытого аукциона (issue #94); события realtime — issue #97. */
@Module({
  imports: [RealtimeModule],
  controllers: [BidsController],
  providers: [
    PrismaService,
    {
      provide: BidsService,
      useFactory: (prisma: PrismaService, events: AuctionEventsPort) =>
        new BidsService(prisma as unknown as BidsDb, undefined, events),
      inject: [PrismaService, AUCTION_EVENTS],
    },
  ],
})
export class BidsModule {}
