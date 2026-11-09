import { DashboardModule } from './dashboard/dashboard.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MembersModule } from './members/members.module';
import { SettingsModule } from './settings/settings.module';
import { EventsModule } from './events/events.module';
import { CheckInModule } from './checkin/checkin.module';
import { ConductModule } from './conduct/conduct.module';
import { DkpModule } from './dkp/dkp.module';
import { AbsencesModule } from './absences/absences.module';
import { RulesModule } from './rules/rules.module';
import { AuditModule } from './audit/audit.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ItemsModule } from './items/items.module';
import { LootModule } from './loot/loot.module';

@Module({
  imports: [
    DashboardModule,
    PrismaModule,
    AuthModule,
    MembersModule,
    SettingsModule,
    EventsModule,
    CheckInModule,
    AbsencesModule,
    ConductModule,
    DkpModule,
    AuditModule,
    ProfilesModule,
    RulesModule,
    ItemsModule,
    LootModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
