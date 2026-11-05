import { Strategy } from 'passport-discord';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable } from '@nestjs/common';
import type { SessionUser } from './session.types';
import type { AuthService } from './auth.service';

/** Токен для ручной передачи сервиса в стратегию (обход DI-ограничения passport). */
export const AUTH_SERVICE = 'AUTH_SERVICE';

/**
 * Discord OAuth2. Аутентификацию делает passport; логику входа (bootstrap
 * первого Главы и т.д.) делегируем AuthService и возвращаем SessionUser —
 * он попадёт в req.user, контроллер положит его в сессию.
 *
 * Сервис приходит через @Inject(AUTH_SERVICE): Nest не может вывести тип
 * параметра super-конструктора PassportStrategy автоматически.
 */
@Injectable()
export class DiscordStrategy extends PassportStrategy(Strategy, 'discord') {
  constructor(@Inject(AUTH_SERVICE) private readonly authService: AuthService) {
    super({
      clientID: process.env.DISCORD_CLIENT_ID ?? '',
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
      callbackURL:
        process.env.DISCORD_CALLBACK_URL ?? 'http://localhost:3001/auth/discord/callback',
      scope: ['identify'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: { id: string; username: string },
  ): Promise<SessionUser> {
    return this.authService.loginWithDiscord({
      discordId: profile.id,
      username: profile.username,
    });
  }
}
