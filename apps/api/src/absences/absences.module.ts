import { Module } from '@nestjs/common';
import { SETTING_DEFAULTS } from '@dkp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EventsModule } from '../events/events.module';
import { EventsService } from '../events/events.service';
import { AbsencesController } from './absences.controller';
import { AbsencesService, type AbsencesDb, type AbsencesSettings } from './absences.service';

/** Отсутствия (issue #11). Связывает хук завершения ивентов с авто-отметками. */
@Module({
  imports: [EventsModule],
  controllers: [AbsencesController],
  providers: [
    PrismaService,
    {
      provide: AbsencesService,
      useFactory: (prisma: PrismaService, events: EventsService) => {
        const settings: AbsencesSettings = {
          deadlineBeforeStartSec: SETTING_DEFAULTS['absence.deadlineBeforeStartSec'],
        };
        const service = new AbsencesService(
          prisma as unknown as AbsencesDb,
          settings,
          () => new Date(),
        );
        // Хук (план 2.3): при FINISHED отсутствующим — EXCUSED_ABSENCE.
        events.onEventFinished = (eventId, startsAt, endsAt) =>
          service.markExcusedForFinishedEvent(eventId, startsAt, endsAt);
        return service;
      },
      inject: [PrismaService, EventsService],
    },
  ],
})
export class AbsencesModule {}
