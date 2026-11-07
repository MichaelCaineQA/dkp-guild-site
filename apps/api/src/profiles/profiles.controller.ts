import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
@UseGuards(AuthGuard, PermissionsGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}
  @Get(':id')
  @RequirePermission('profile.view')
  get(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.profiles.get(id, req.session!.user!);
  }

  @Patch(':id')
  @RequirePermission('profile.edit_own')
  updateOwn(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.profiles.updateOwn(id, body, {
      memberId: user.memberId,
      rank: user.rank,
      isAdmin: user.isAdmin,
    });
  }
}
