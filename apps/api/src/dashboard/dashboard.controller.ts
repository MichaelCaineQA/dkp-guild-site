import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { DashboardService } from './dashboard.service';
@Controller('dashboard')
@UseGuards(AuthGuard, PermissionsGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  get(@Req() req: AuthedRequest) {
    return this.dashboard.get(req.session!.user!);
  }
}
