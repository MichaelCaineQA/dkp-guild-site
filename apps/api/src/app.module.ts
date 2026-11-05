import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MembersModule } from './members/members.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [PrismaModule, AuthModule, MembersModule, SettingsModule],
  controllers: [AppController],
})
export class AppModule {}
