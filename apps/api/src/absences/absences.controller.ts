import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { AbsencesService } from './absences.service';

/**
 * Отсутствия (issue #11): свои заявки — всем членам, список всех —
 * офицерам+; «Увидел» — absence.see. Настройки читаются на запрос.
 */
@Controller('absences')
@UseGuards(AuthGuard, PermissionsGuard)
export class AbsencesController {
  constructor(private readonly absences: AbsencesService) {}

  /** Свои заявки. */
  @Get('mine')
  @RequirePermission('members.view_roster')
  mine(@Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.absences.list(user.memberId!);
  }

  /** Все активные заявки — офицерам и выше. */
  @Get()
  @RequirePermission('absence.see')
  list() {
    return this.absences.list();
  }

  /** Отсутствующие по конкретному ивенту (для карточки/проведения). */
  @Get('for-event')
  @RequirePermission('members.view_roster')
  forEvent(@Query('startsAt') startsAt?: string, @Query('eventId') eventId?: string) {
    const date = startsAt ? new Date(startsAt) : new Date();
    return this.absences.forEvent(date, eventId);
  }

  @Post()
  @RequirePermission('members.view_roster')
  create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    const actor = { memberId: user.memberId!, isAdmin: user.isAdmin, rank: user.rank };
    return this.absences.create(user.memberId!, body, actor);
  }

  @Delete(':id')
  @RequirePermission('members.view_roster')
  cancel(@Param('id') id: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    const actor = { memberId: user.memberId!, isAdmin: user.isAdmin, rank: user.rank };
    return this.absences.cancel(id, actor);
  }

  /** Отметка «Увидел» — РЛ/офицерам+ (право absence.see). */
  @Post(':id/seen')
  @RequirePermission('absence.see')
  markSeen(@Param('id') id: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    const actor = { memberId: user.memberId!, isAdmin: user.isAdmin, rank: user.rank };
    return this.absences.markSeen(id, actor);
  }
}
