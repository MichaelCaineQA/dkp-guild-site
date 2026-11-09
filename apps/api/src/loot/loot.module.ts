import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LootController } from './loot.controller';
import { LootService, type LootDb } from './loot.service';

/** Дроп и лоты аукциона в проведении ивента (issue #93). */
@Module({
  controllers: [LootController],
  providers: [
    PrismaService,
    {
      provide: LootService,
      useFactory: (prisma: PrismaService) => new LootService(prisma as unknown as LootDb),
      inject: [PrismaService],
    },
  ],
})
export class LootModule {}
