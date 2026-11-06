import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditController } from './audit.controller';
import { AuditService, type AuditDb } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [
    {
      provide: AuditService,
      useFactory: (prisma: PrismaService) => new AuditService(prisma as unknown as AuditDb),
      inject: [PrismaService],
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
