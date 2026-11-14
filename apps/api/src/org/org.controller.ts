import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { OrgService } from './org.service';

@Controller('org')
@UseGuards(AuthGuard)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Post('kps')
  createKp(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.org.createKp(body, req.session!.user!);
  }

  @Post('packs')
  createPack(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.org.createPack(body, req.session!.user!);
  }

  @Post('members/:id/transfer')
  moveMember(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.org.moveMember(id, body, req.session!.user!);
  }

  @Post('packs/:id/transfer')
  movePack(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.org.movePack(id, body, req.session!.user!);
  }

  @Post('kps/:id/leader')
  setKpLeader(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.org.setKpLeader(id, body, req.session!.user!);
  }

  @Post('packs/:id/leader')
  setPackLeader(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.org.setPackLeader(id, body, req.session!.user!);
  }
}
