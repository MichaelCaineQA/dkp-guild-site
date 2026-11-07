import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
@Module({
  imports: [AuditModule],
  controllers: [DashboardController],
  providers: [
    {
      provide: DashboardService,
      inject: [PrismaService, AuditService],
      useFactory: (db: PrismaService, audit: AuditService) => new DashboardService(db, audit),
    },
  ],
})
export class DashboardModule {}
