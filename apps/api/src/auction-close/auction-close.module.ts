import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuctionCloseService, type CloseDb } from './auction-close.service';

/**
 * Закрытие истёкших лотов и автосписание ДКП (issue #95).
 * Период прохода свипера — AUCTION_CLOSE_INTERVAL_MS (по умолчанию 1000 мс,
 * 0 отключает свипер — для тестов); просроченные за простой лоты закрываются
 * первым проходом при старте. События realtime — issue #97.
 */
@Module({
  imports: [RealtimeModule],
  providers: [
    PrismaService,
    {
      provide: AuctionCloseService,
      useFactory: (prisma: PrismaService, events: AuctionEventsPort) => {
        const interval = Number(process.env.AUCTION_CLOSE_INTERVAL_MS ?? 1000);
        return new AuctionCloseService(
          prisma as unknown as CloseDb,
          undefined,
          Number.isFinite(interval) && interval >= 0 ? interval : 1000,
          events,
        );
      },
      inject: [PrismaService, AUCTION_EVENTS],
    },
  ],
})
export class AuctionCloseModule {}
