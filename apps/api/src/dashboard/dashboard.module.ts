import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../audit/audit.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuditService } from '../audit/audit.service';
import { AuctionsService } from '../auctions/auctions.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
@Module({
  imports: [AuditModule, AuctionsModule],
  controllers: [DashboardController],
  providers: [
    {
      provide: DashboardService,
      inject: [PrismaService, AuditService, AuctionsService],
      useFactory:
        (db: PrismaService, audit: AuditService, auctions: AuctionsService) =>
          new DashboardService(db, audit, auctions),
    },
  ],
})
export class DashboardModule {}
