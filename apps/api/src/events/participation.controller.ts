import { Body, Controller, Get, Header, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { ParticipationService } from './participation.service';
@Controller('events')
@UseGuards(AuthGuard, PermissionsGuard)
export class ParticipationController {
  constructor(private readonly participation: ParticipationService) {}
  @Get(':id/participation')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  get(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.participation.get(id, req.session!.user!.memberId);
  }
  @Post(':id/participation')
  @RequirePermission('members.view_roster')
  update(@Param('id') id: string, @Req() req: AuthedRequest, @Body() body: unknown) {
    return this.participation.update(id, req.session!.user!.memberId, body);
  }
}
