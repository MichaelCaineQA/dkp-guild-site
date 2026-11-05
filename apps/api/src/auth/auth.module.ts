import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService, type AuthDb } from './auth.service';
import { AUTH_SERVICE, DiscordStrategy } from './discord.strategy';
import { LinkRequestService, type LinkRequestDb } from './link-request.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Грубый глобальный троттлинг; на вход админа — свой @Throttle в контроллере
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [AuthController],
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
    { provide: AUTH_SERVICE, useExisting: AuthService },
    DiscordStrategy,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AuthModule {}
