import { ScreenshotsController } from './screenshots.controller';
import { ScreenshotsService, type ScreenshotDb } from './screenshots.service';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService, type AuthDb } from './auth.service';
import { AUTH_SERVICE, DiscordStrategy } from './discord.strategy';
import { isDiscordConfigured } from './discord-config';
import { LinkRequestService, type LinkRequestDb } from './link-request.service';

@Module({
  imports: [
    AuditModule,
    ConfigModule.forRoot({ isGlobal: true }),
    // Грубый глобальный троттлинг; на вход админа — свой @Throttle в контроллере
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [AuthController, ScreenshotsController],
  providers: [
    // Сервисы работают с минимальными интерфейсами БД — юнит-тесты без Prisma.
    {
      provide: AuthService,
      useFactory: (prisma: PrismaService) => new AuthService(prisma as unknown as AuthDb),
      inject: [PrismaService],
    },
    {
      provide: LinkRequestService,
      useFactory: (prisma: PrismaService) =>
        new LinkRequestService(prisma as unknown as LinkRequestDb),
      inject: [PrismaService],
    },
    {
      provide: ScreenshotsService,
      useFactory: (prisma: PrismaService) =>
        new ScreenshotsService(prisma as unknown as ScreenshotDb),
      inject: [PrismaService],
    },
    { provide: AUTH_SERVICE, useExisting: AuthService },
    {
      provide: DiscordStrategy,
      // Passport не принимает пустой clientID. Проверяем после загрузки ConfigModule,
      // чтобы резервный вход работал и без настроенного Discord.
      useFactory: (auth: AuthService) => (isDiscordConfigured() ? new DiscordStrategy(auth) : null),
      inject: [AuthService],
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AuthModule {}
