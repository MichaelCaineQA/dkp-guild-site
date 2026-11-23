import { Module } from '@nestjs/common';
import { DiscordDeliveryService } from './discord-delivery.service';
import { DiscordChannelValidator } from './discord-channel-validator';
import { DiscordSettingsController } from './discord-settings.controller';
import { DiscordSettingsService } from './discord-settings.service';
import { DiscordReminderScheduler } from './discord-reminder.scheduler';

@Module({
  controllers: [DiscordSettingsController],
  providers: [
    DiscordDeliveryService,
    DiscordChannelValidator,
    DiscordSettingsService,
    DiscordReminderScheduler,
  ],
  exports: [DiscordSettingsService],
})
export class DiscordNotificationsModule {}
