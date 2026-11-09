import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuctionCloseService, type CloseDb } from './auction-close.service';

/**
 * Закрытие истёкших лотов и автосписание ДКП (issue #95).
 * Период прохода свипера — AUCTION_CLOSE_INTERVAL_MS (по умолчанию 1000 мс,
 * 0 отключает свипер — для тестов); просроченные за простой лоты закрываются
 * первым проходом при старте.
 */
@Module({
  providers: [
    PrismaService,
    {
      provide: AuctionCloseService,
      useFactory: (prisma: PrismaService) => {
        const interval = Number(process.env.AUCTION_CLOSE_INTERVAL_MS ?? 1000);
        return new AuctionCloseService(
          prisma as unknown as CloseDb,
          undefined,
          Number.isFinite(interval) && interval >= 0 ? interval : 1000,
        );
      },
      inject: [PrismaService],
    },
  ],
})
export class AuctionCloseModule {}
