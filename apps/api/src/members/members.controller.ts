import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { MembersService } from './members.service';

/** Члены гильдии: состав, создание/редактирование, смена рангов (issue #6). */
@Controller('members')
@UseGuards(AuthGuard, PermissionsGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Состав с фильтрами — всем членам гильдии. */
  @Get()
  @RequirePermission('members.view_roster')
  roster(@Query() query: Record<string, string>) {
    return this.members.roster(query);
  }

  @Get(':id')
  @RequirePermission('members.view_roster')
  getOne(@Param('id') id: string) {
    return this.members.getOne(id);
  }

  @Post()
  @RequirePermission('members.manage')
  create(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.members.create(body, toActor(req));
  }

  @Patch(':id')
  @RequirePermission('members.manage')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.members.update(id, body, toActor(req));
  }

  /** Смена ранга — Глава/Админ, комментарий обязателен (аудит). */
  @Post(':id/change-rank')
  @RequirePermission('members.change_rank')
  changeRank(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.members.changeRank(id, body, toActor(req));
  }
}

/** Актор из сессии для аудита: резервный админ действует без Member. */
function toActor(req: AuthedRequest) {
  const user = req.session!.user!;
  return { memberId: user.memberId, isAdmin: user.isAdmin, userId: user.userId };
}
