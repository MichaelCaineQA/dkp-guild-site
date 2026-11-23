import { Module } from '@nestjs/common';
import { DiscordDeliveryService } from './discord-delivery.service';

@Module({ providers: [DiscordDeliveryService] })
export class DiscordNotificationsModule {}
