import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MembersController } from './members.controller';
import { MembersService, type MembersDb } from './members.service';

@Module({
  controllers: [MembersController],
  providers: [
    // Сервис работает с минимальным интерфейсом БД — юнит-тесты без Prisma.
    {
      provide: MembersService,
      useFactory: (prisma: PrismaService) =>
        new MembersService(prisma as unknown as MembersDb),
      inject: [PrismaService],
    },
  ],
})
export class MembersModule {}
