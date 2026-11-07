import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { WeekService } from './week.service';
@Controller('schedule')
@UseGuards(AuthGuard, PermissionsGuard)
export class WeekController {
  constructor(private readonly week: WeekService) {}
  @Get('week')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  list(@Query() query: Record<string, string>, @Req() req: AuthedRequest) {
    return this.week.list(query, req.session!.user!.memberId);
  }
}
