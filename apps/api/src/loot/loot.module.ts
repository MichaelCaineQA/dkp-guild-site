import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import { RealtimeModule } from '../realtime/realtime.module';
import { LootController } from './loot.controller';
import { LootService, type LootDb } from './loot.service';

/** Дроп и лоты аукциона в проведении ивента (issue #93); realtime — #97. */
@Module({
  imports: [RealtimeModule],
  controllers: [LootController],
  providers: [
    PrismaService,
    {
      provide: LootService,
      useFactory: (prisma: PrismaService, events: AuctionEventsPort) =>
        new LootService(prisma as unknown as LootDb, events),
      inject: [PrismaService, AUCTION_EVENTS],
    },
  ],
})
export class LootModule {}
