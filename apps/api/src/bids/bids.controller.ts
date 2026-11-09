import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { BidsService } from './bids.service';

/**
 * Ставки открытого аукциона (issue #94, план 2.4/2.6/6). Ставить могут все
 * члены гильдии (матрица 2.6, auction.bid); история ставок открыта всем.
 */
@Controller('auctions/:auctionId/bids')
@UseGuards(AuthGuard, PermissionsGuard)
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  /** Открытая история ставок лота. */
  @Get()
  @RequirePermission('members.view_roster')
  list(@Param('auctionId') auctionId: string) {
    return this.bids.list(auctionId);
  }

  /** Приём ставки. Проверки правил и баланса — в сервисе, атомарно. */
  @Post()
  @RequirePermission('auction.bid')
  place(@Param('auctionId') auctionId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.bids.place(auctionId, body, {
      memberId: user.memberId,
      isAdmin: user.isAdmin,
    });
  }
}
