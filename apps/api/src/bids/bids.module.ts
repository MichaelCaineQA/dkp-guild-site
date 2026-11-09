import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BidsController } from './bids.controller';
import { BidsService, type BidsDb } from './bids.service';

/** Ставки открытого аукциона (issue #94). */
@Module({
  controllers: [BidsController],
  providers: [
    PrismaService,
    {
      provide: BidsService,
      useFactory: (prisma: PrismaService) => new BidsService(prisma as unknown as BidsDb),
      inject: [PrismaService],
    },
  ],
})
export class BidsModule {}
