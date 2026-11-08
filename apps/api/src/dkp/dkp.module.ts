import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DkpController } from './dkp.controller';
import { DkpService, type DkpDb } from './dkp.service';
import { AdminGrantService } from './admin-grant.service';

/** Журнал ДКП (issue #12) — чтение, append-only. */
@Module({
  controllers: [DkpController],
  providers: [
    PrismaService,
    {
      provide: AdminGrantService,
      useFactory: (prisma: PrismaService) => new AdminGrantService(prisma),
      inject: [PrismaService],
    },
    {
      provide: DkpService,
      useFactory: (prisma: PrismaService) => new DkpService(prisma as unknown as DkpDb),
      inject: [PrismaService],
    },
  ],
})
export class DkpModule {}
