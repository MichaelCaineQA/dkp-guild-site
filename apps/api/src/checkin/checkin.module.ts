import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInController } from './checkin.controller';

/** Чек-ин кодами (issue #9): контроллер собирает сервис на запрос. */
@Module({
  controllers: [CheckInController],
  providers: [PrismaService],
})
export class CheckInModule {}
