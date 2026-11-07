import { ParticipationController } from './participation.controller';
import { ParticipationService } from './participation.service';
import { WeekController } from './week.controller';
import { WeekService } from './week.service';
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsController } from './events.controller';
import { EventsService, type EventsDb } from './events.service';

/** Расписание ивентов (issue #8). Экспортирует сервис для хука отсутствий (#11). */
@Module({
  controllers: [EventsController, WeekController, ParticipationController],
  providers: [
    {
      provide: ParticipationService,
      useFactory: (db: PrismaService) => new ParticipationService(db),
      inject: [PrismaService],
    },
    {
      provide: WeekService,
      useFactory: (db: PrismaService) => new WeekService(db),
      inject: [PrismaService],
    },
    // Сервис работает с минимальным интерфейсом БД — тесты без Prisma.
    {
      provide: EventsService,
      useFactory: (prisma: PrismaService) => new EventsService(prisma as unknown as EventsDb),
      inject: [PrismaService],
    },
  ],
  exports: [EventsService],
})
export class EventsModule {}
