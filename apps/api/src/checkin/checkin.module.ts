import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsModule } from '../events/events.module';
import { EventsService } from '../events/events.service';
import { CheckInController } from './checkin.controller';
import { CHECKIN_ENC_KEY } from './enc-key';
import { launchCheckInCode, readCheckInWindowSec, type CheckInLaunchDb } from './launch';

/** Метка провайдера, который связывает запуск кодов со сменой статуса ивента. */
export const CHECK_IN_LAUNCH = Symbol('CHECK_IN_LAUNCH');

/**
 * Хук запуска кода (план 2.2, решение №23): «Начать ивент» открывает окно
 * стартового кода, «Завершить ивент» — финального. Тот же обработчик работает
 * в приложении и в database-спеках.
 */
export function attachCheckInLaunch(events: EventsService, encKeyHex = CHECKIN_ENC_KEY): void {
  events.onEventCodeLaunch = async (tx, eventId, phase, actor, now) => {
    const db = tx as unknown as CheckInLaunchDb;
    await launchCheckInCode(
      db,
      eventId,
      phase,
      actor,
      now,
      encKeyHex,
      await readCheckInWindowSec(db),
    );
  };
}

/** Чек-ин кодами (issue #9): контроллер собирает сервис на запрос. */
@Module({
  imports: [EventsModule],
  controllers: [CheckInController],
  providers: [
    PrismaService,
    {
      provide: CHECK_IN_LAUNCH,
      useFactory: (events: EventsService) => attachCheckInLaunch(events),
      inject: [EventsService],
    },
  ],
})
export class CheckInModule {}
