import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { LootService } from './loot.service';

/**
 * Дроп и лоты в проведении ивента (issue #93, план 2.4/2.6/6). Доступ —
 * управляющим ивента; проверка events.conduct по конкретному ивенту —
 * в сервисе, декларативное право участника гильдии — на контроллере.
 */
@Controller('events/:eventId/loot')
@UseGuards(AuthGuard, PermissionsGuard)
export class LootController {
  constructor(private readonly loot: LootService) {}

  /** Дропы ивента с лотами. */
  @Get()
  @RequirePermission('members.view_roster')
  list(@Param('eventId') eventId: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.loot.listForActor(
      eventId,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }

  /** Начальные значения лота по предмету — из настроек и справочника. */
  @Get('defaults/:itemId')
  @RequirePermission('members.view_roster')
  defaults(
    @Param('eventId') eventId: string,
    @Param('itemId') itemId: string,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    return this.loot.defaultsForActor(
      eventId,
      itemId,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }

  /** Фиксация выпавшего предмета. */
  @Post('drops')
  @RequirePermission('members.view_roster')
  createDrop(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    return this.loot.createDrop(
      eventId,
      body,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }

  /** Создание открытого лота по зафиксированному дропу. */
  @Post('drops/:dropId/lot')
  @RequirePermission('members.view_roster')
  createLot(
    @Param('eventId') eventId: string,
    @Param('dropId') dropId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    return this.loot.createLot(
      eventId,
      dropId,
      body,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }
}
