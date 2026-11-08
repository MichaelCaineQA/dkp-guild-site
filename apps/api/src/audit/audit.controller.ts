import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { can } from '@dkp/shared';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('members.view_roster')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: Record<string, string>, @Req() req: AuthedRequest) {
    return this.audit.list(query, req.session!.user!);
  }
  @Get('actions')
  actions(@Req() req: AuthedRequest) {
    return can(req.session!.user!, 'audit.view') ? this.audit.actions() : [];
  }
}
