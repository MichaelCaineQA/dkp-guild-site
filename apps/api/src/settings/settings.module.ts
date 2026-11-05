import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventTypesController } from './event-types.controller';
import { EventTypesService, type EventTypesDb } from './event-types.service';
import { SettingsController } from './settings.controller';
import { SettingsService, type SettingsDb } from './settings.service';

/** Справочники и настройки (issue #7): EventType CRUD + Setting read/write. */
@Module({
  controllers: [SettingsController, EventTypesController],
  providers: [
    // Сервисы работают с минимальными интерфейсами БД — тесты без Prisma.
    {
      provide: SettingsService,
      useFactory: (prisma: PrismaService) =>
        new SettingsService(prisma as unknown as SettingsDb),
      inject: [PrismaService],
    },
    {
      provide: EventTypesService,
      useFactory: (prisma: PrismaService) =>
        new EventTypesService(prisma as unknown as EventTypesDb),
      inject: [PrismaService],
    },
  ],
})
export class SettingsModule {}
