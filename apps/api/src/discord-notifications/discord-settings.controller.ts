import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { DiscordSettingsService } from './discord-settings.service';

@Controller('settings/discord')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('settings.manage')
export class DiscordSettingsController {
  constructor(private readonly settings: DiscordSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  update(@Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.settings.update(body, { memberId: user.memberId, isAdmin: user.isAdmin });
  }

  @Post('test/:kind')
  test(@Param('kind') kind: string) {
    return this.settings.test(kind);
  }

  @Get('test/:id')
  testStatus(@Param('id') id: string) {
    return this.settings.testStatus(id);
  }
}
