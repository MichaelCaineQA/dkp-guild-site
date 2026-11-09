import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuctionManageController } from './auction-manage.controller';
import { AuctionManageService, type ManageDb } from './auction-manage.service';

/** Ручное управление лотом и аудит (issue #96). */
@Module({
  controllers: [AuctionManageController],
  providers: [
    PrismaService,
    {
      provide: AuctionManageService,
      useFactory: (prisma: PrismaService) =>
        new AuctionManageService(prisma as unknown as ManageDb),
      inject: [PrismaService],
    },
  ],
})
export class AuctionManageModule {}
