import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MembersModule } from './members/members.module';
import { SettingsModule } from './settings/settings.module';
import { EventsModule } from './events/events.module';
import { CheckInModule } from './checkin/checkin.module';
import { ConductModule } from './conduct/conduct.module';
import { AbsencesModule } from './absences/absences.module';

@Module({
  imports: [PrismaModule, AuthModule, MembersModule, SettingsModule, EventsModule, CheckInModule, AbsencesModule, ConductModule],
  controllers: [AppController],
})
export class AppModule {}
