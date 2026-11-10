import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuctionManageController } from './auction-manage.controller';
import { AuctionManageService, type ManageDb } from './auction-manage.service';

/** Ручное управление лотом и аудит (issue #96); события realtime — #97. */
@Module({
  imports: [RealtimeModule],
  controllers: [AuctionManageController],
  providers: [
    PrismaService,
    {
      provide: AuctionManageService,
      useFactory: (prisma: PrismaService, events: AuctionEventsPort) =>
        new AuctionManageService(prisma as unknown as ManageDb, undefined, events),
      inject: [PrismaService, AUCTION_EVENTS],
    },
  ],
})
export class AuctionManageModule {}
