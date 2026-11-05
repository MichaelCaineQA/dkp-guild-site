import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConductController, conductSettings } from './conduct.controller';
import { ConductService, type ConductDb } from './conduct.service';

/** Проведение ивента (issue #10). */
@Module({
  controllers: [ConductController],
  providers: [
    PrismaService,
    {
      provide: ConductService,
      useFactory: (prisma: PrismaService) =>
        new ConductService(prisma as unknown as ConductDb, conductSettings()),
      inject: [PrismaService],
    },
  ],
})
export class ConductModule {}
