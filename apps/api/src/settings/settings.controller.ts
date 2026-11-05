import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { SettingsService } from './settings.service';

/** Настройки системы: чтение всем членам, запись — Главе/Админу (issue #7). */
@Controller('settings')
@UseGuards(AuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission('members.view_roster')
  getAll() {
    return this.settings.getAll();
  }

  @Put()
  @RequirePermission('settings.manage')
  update(@Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.settings.update(body, { memberId: user.memberId, isAdmin: user.isAdmin });
  }

  /** Игровой цикл (план 2.1): якорь и длительности фаз. */
  @Get('game-time')
  @RequirePermission('members.view_roster')
  getGameTime() {
    return this.settings.getGameTime();
  }

  @Put('game-time')
  @RequirePermission('settings.manage')
  updateGameTime(@Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.settings.updateGameTime(body, {
      memberId: user.memberId,
      isAdmin: user.isAdmin,
    });
  }
}
