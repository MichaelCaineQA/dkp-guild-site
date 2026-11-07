import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { ConductService } from './conduct.service';

/**
 * Проведение ивента (issue #10, план 2.2 п.6): чек-лист, ручные отметки
 * и начисления — Главе, Админу и назначенному РЛ ивента. Настройки читаются на запрос.
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

  @Post('summary')
  @RequirePermission('members.view_roster')
  applySummary(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    return this.conduct.applySummary(
      eventId,
      body,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
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
  manualDkp(@Param('eventId') eventId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.conduct.manualDkp(
      eventId,
      body,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }
}
