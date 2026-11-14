import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import { RealtimeModule } from '../realtime/realtime.module';
import { MembersController } from './members.controller';
import { MembersService, type MembersDb } from './members.service';

@Module({
  imports: [RealtimeModule],
  controllers: [MembersController],
  providers: [
    // Сервис работает с минимальным интерфейсом БД — юнит-тесты без Prisma.
    {
      provide: MembersService,
      useFactory: (prisma: PrismaService, events: AuctionEventsPort) =>
        new MembersService(prisma as unknown as MembersDb, undefined, events),
      inject: [PrismaService, AUCTION_EVENTS],
    },
  ],
})
export class MembersModule {}
