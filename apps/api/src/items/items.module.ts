import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ItemsController } from './items.controller';
import { ItemsService, type ItemsDb } from './items.service';

/** Справочник предметов аукциона (issue #92, план 2.4). */
@Module({
  controllers: [ItemsController],
  providers: [
    PrismaService,
    {
      provide: ItemsService,
      useFactory: (prisma: PrismaService) => new ItemsService(prisma as unknown as ItemsDb),
      inject: [PrismaService],
    },
  ],
})
export class ItemsModule {}
