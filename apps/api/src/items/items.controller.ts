import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { ItemsService } from './items.service';

/**
 * Справочник предметов (план 2.4, матрица 2.6): чтение — всем членам гильдии,
 * ведение — Офицеру/Главе/Админу (право items.manage). Каждое изменение —
 * в AuditLog (план 2.9).
 */
@Controller('items')
@UseGuards(AuthGuard, PermissionsGuard)
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermission('members.view_roster')
  list() {
    return this.items.list();
  }

  @Post()
  @RequirePermission('items.manage')
  create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.items.create(body, { memberId: user.memberId, isAdmin: user.isAdmin });
  }

  @Put(':id')
  @RequirePermission('items.manage')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.items.update(id, body, { memberId: user.memberId, isAdmin: user.isAdmin });
  }

  @Delete(':id')
  @RequirePermission('items.manage')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.items.remove(id, { memberId: user.memberId, isAdmin: user.isAdmin });
  }
}
