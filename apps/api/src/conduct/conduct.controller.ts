import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SETTING_DEFAULTS } from '@dkp/shared';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { ConductService, type ConductSettings } from './conduct.service';

/**
 * Проведение ивента (issue #10, план 2.2 п.6): чек-лист, ручные отметки
 * и начисления — офицерам+ и РЛ ивента. Настройки читаются на запрос.
 */
@Controller('events/:eventId/conduct')
@UseGuards(AuthGuard, PermissionsGuard)
export class ConductController {
  constructor(private readonly conduct: ConductService) {}

  /** Чек-лист: все члены, отметки, ДКП по ивенту. */
  @Get('checklist')
  @RequirePermission('members.view_roster')
  checklist(@Param('eventId') eventId: string) {
    return this.conduct.checklist(eventId);
  }

  /** Ручная отметка посещения (был/опоздал/ушёл/неявка). */
  @Post('attendance')
  @RequirePermission('members.view_roster')
  setAttendance(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    return this.conduct.setAttendance(
      eventId,
      body,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }

  /** Ручная выдача чек-ин статуса (+доля фазы). */
  @Post('manual-checkin')
  @RequirePermission('members.view_roster')
  manualCheckIn(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    return this.conduct.manualCheckIn(
      eventId,
      body,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }

  /** Ручное начисление/корректировка ДКП. */
  @Post('dkp')
  @RequirePermission('members.view_roster')
  manualDkp(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    return this.conduct.manualDkp(
      eventId,
      body,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }
}

/** Настройки долей чек-ина из реестра (50/50) — для фабрики сервиса. */
export function conductSettings(): ConductSettings {
  return {
    startSharePct: SETTING_DEFAULTS['checkin.startSharePct'],
    endSharePct: SETTING_DEFAULTS['checkin.endSharePct'],
  };
}
