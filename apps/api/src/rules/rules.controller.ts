import { Body, Controller, Get, Param, Put, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { RulesService } from './rules.service';

@Controller('rules')
@UseGuards(AuthGuard, PermissionsGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}
  @Get(':slug')
  @RequirePermission('members.view_roster')
  get(@Param('slug') slug: string) {
    return this.rules.get(slug);
  }
  @Get(':slug/versions')
  @RequirePermission('members.view_roster')
  history(@Param('slug') slug: string) {
    return this.rules.history(slug);
  }
  @Get(':slug/versions/:version')
  @RequirePermission('members.view_roster')
  version(@Param('slug') slug: string, @Param('version') version: string) {
    return this.rules.version(slug, version);
  }
  @Put(':slug')
  @RequirePermission('rules.edit')
  update(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.rules.update(slug, body, { memberId: user.memberId, userId: user.userId });
  }
  @Post(':slug/restore')
  @RequirePermission('rules.edit')
  restore(@Param('slug') slug: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.rules.restore(slug, body, { memberId: user.memberId, userId: user.userId });
  }
}
