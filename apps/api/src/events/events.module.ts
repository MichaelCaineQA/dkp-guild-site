import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsController } from './events.controller';
import { EventsService, type EventsDb } from './events.service';

/** Расписание ивентов (issue #8). */
@Module({
  controllers: [EventsController],
  providers: [
    // Сервис работает с минимальным интерфейсом БД — тесты без Prisma.
    {
      provide: EventsService,
      useFactory: (prisma: PrismaService) => new EventsService(prisma as unknown as EventsDb),
      inject: [PrismaService],
    },
  ],
})
export class EventsModule {}
