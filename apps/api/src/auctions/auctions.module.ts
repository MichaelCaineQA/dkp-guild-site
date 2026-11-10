import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuctionsController } from './auctions.controller';
import { AuctionsService, type AuctionsDb } from './auctions.service';

/** Список лотов аукциона и данные виджета «Мой аукцион» (issue #98). */
@Module({
  controllers: [AuctionsController],
  providers: [
    PrismaService,
    {
      provide: AuctionsService,
      useFactory: (prisma: PrismaService) =>
        new AuctionsService(prisma as unknown as AuctionsDb),
      inject: [PrismaService],
    },
  ],
  exports: [AuctionsService],
})
export class AuctionsModule {}
