import { Injectable, ServiceUnavailableException, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isDiscordConfigured } from './discord-config';

@Injectable()
export class DiscordGuard extends AuthGuard('discord') {
  canActivate(context: ExecutionContext) {
    if (!isDiscordConfigured()) {
      throw new ServiceUnavailableException('Вход через Discord пока не настроен');
    }
    return super.canActivate(context);
  }
}
