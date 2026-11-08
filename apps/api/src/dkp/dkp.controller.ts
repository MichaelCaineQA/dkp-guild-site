import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { DkpService } from './dkp.service';
import { AdminGrantService } from './admin-grant.service';

/**
 * Журнал ДКП (issue #12): операции и балансы публичны всем членам
 * гильдии (решение №4). Только чтение — журнал append-only.
 */
@Controller('dkp')
@UseGuards(AuthGuard, PermissionsGuard)
export class DkpController {
  constructor(
    private readonly dkp: DkpService,
    private readonly grants: AdminGrantService,
  ) {}

  @Post('admin-grants')
  @RequirePermission('members.view_roster')
  grant(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.grants.grant(body, req.session!.user!.isAdmin);
  }

  /** Операции с фильтрами: /dkp/entries?memberId=&eventId=&type=&from=&to= */
  @Get('entries')
  @RequirePermission('members.view_roster')
  list(@Query() query: Record<string, string>) {
    return this.dkp.list(query);
  }

  /** Балансы всех членов (сводка). */
  @Get('balances')
  @RequirePermission('members.view_roster')
  balances() {
    return this.dkp.balances();
  }

  /** Баланс одного игрока. */
  @Get('balances/:memberId')
  @RequirePermission('members.view_roster')
  memberBalance(@Param('memberId') memberId: string) {
    return this.dkp.memberBalance(memberId);
  }
}
