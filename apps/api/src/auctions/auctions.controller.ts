import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AUCTION_LIST_STATUSES, type AuctionListStatus } from '@dkp/shared';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { AuctionsService } from './auctions.service';

/**
 * Список лотов экрана аукциона (issue #98, план 6 п. 10): открытые,
 * завершённые и отменённые. Ставки видны всем членам гильдии (план 6);
 * свои действия с лотом — проведение ивента (loot, #96). Лот вне ивента
 * «хранилище гильдии» создаёт Глава/Админ прямо отсюда (#137, план 2.4).
 */
@Controller('auctions')
@UseGuards(AuthGuard, PermissionsGuard)
export class AuctionsController {
  constructor(private readonly auctions: AuctionsService) {}

  /** ?status=OPEN|CLOSED|CANCELLED (по умолчанию OPEN). */
  @Get()
  @RequirePermission('members.view_roster')
  list(
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ): ReturnType<AuctionsService['list']> {
    if (status !== undefined && !AUCTION_LIST_STATUSES.includes(status as AuctionListStatus)) {
      throw new BadRequestException('Статус лота — OPEN, CLOSED или CANCELLED');
    }
    return this.auctions.list(
      (status as AuctionListStatus | undefined) ?? 'OPEN',
      req.session!.user!.memberId,
    );
  }

  /**
   * Лут-лог (issue #99): ?memberId=&eventId=&itemId=&limit=&offset= —
   * публичная история выдач; фильтры работают по одному и в сочетании.
   */
  @Get('loot-log')
  @RequirePermission('members.view_roster')
  lootLog(@Query() query: Record<string, string>): ReturnType<AuctionsService['lootLog']> {
    return this.auctions.lootLog(query);
  }

  /** Начальные значения лота вне ивента по предмету (#137). */
  @Get('lot-defaults/:itemId')
  @RequirePermission('auctions.create')
  lotDefaults(
    @Param('itemId') itemId: string,
  ): ReturnType<AuctionsService['defaultsForItem']> {
    return this.auctions.defaultsForItem(itemId);
  }

  /** Создание лота вне ивента — «хранилище гильдии» (#137, план 2.4). */
  @Post()
  @RequirePermission('auctions.create')
  createLot(
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): ReturnType<AuctionsService['createLot']> {
    const user = req.session!.user!;
    return this.auctions.createLot(body, { memberId: user.memberId, isAdmin: user.isAdmin });
  }
}
