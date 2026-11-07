import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { AuditService } from './audit.service';

@Controller('audit')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('audit.view')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: Record<string, string>) {
    return this.audit.list(query);
  }
  @Get('actions')
  actions() {
    return this.audit.actions();
  }
}
