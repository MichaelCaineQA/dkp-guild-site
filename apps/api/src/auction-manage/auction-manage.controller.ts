import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { AuctionManageService, type ManageActor } from './auction-manage.service';

/**
 * Ручное управление лотом (issue #96, план 2.4/2.6/2.9/6, п. 8–10).
 * Продление и отмена — управляющим ивента лота, досрочное завершение
 * и ручной победитель — Главе/Админу; точные проверки в сервисе по конкретному
 * лоту и его ивенту, декларативное право участника гильдии — на контроллере.
 */
@Controller('auctions/:auctionId')
@UseGuards(AuthGuard, PermissionsGuard)
export class AuctionManageController {
  constructor(private readonly manage: AuctionManageService) {}

  /** Продлить действующий лот. */
  @Post('extend')
  @RequirePermission('members.view_roster')
  extend(@Param('auctionId') auctionId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.manage.extend(auctionId, body, this.actor(req));
  }

  /** Отменить действующий лот. */
  @Post('cancel')
  @RequirePermission('members.view_roster')
  cancel(@Param('auctionId') auctionId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.manage.cancel(auctionId, body, this.actor(req));
  }

  /** Досрочно завершить лот (победитель — ведущая ставка). */
  @Post('close')
  @RequirePermission('members.view_roster')
  close(@Param('auctionId') auctionId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.manage.closeEarly(auctionId, body, this.actor(req));
  }

  /** Назначить победителя вручную или сменить победителя завершённого лота. */
  @Post('award')
  @RequirePermission('members.view_roster')
  award(@Param('auctionId') auctionId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.manage.assignWinner(auctionId, body, this.actor(req));
  }

  private actor(req: AuthedRequest): ManageActor {
    const user = req.session!.user!;
    return { memberId: user.memberId, isAdmin: user.isAdmin, rank: user.rank };
  }
}
