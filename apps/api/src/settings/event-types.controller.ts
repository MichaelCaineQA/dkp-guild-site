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
import { EventTypesService } from './event-types.service';

/**
 * Справочник типов ивентов (план 2.1): чтение — всем членам, CRUD — офицерам
 * и выше (матрица 2.6: «ведение справочника» — офицер+).
 */
@Controller('event-types')
@UseGuards(AuthGuard, PermissionsGuard)
export class EventTypesController {
  constructor(private readonly eventTypes: EventTypesService) {}

  @Get()
  @RequirePermission('members.view_roster')
  list() {
    return this.eventTypes.list();
  }

  @Post()
  @RequirePermission('items.manage')
  create(@Body() body: { name?: string }, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.eventTypes.create(body.name ?? '', {
      memberId: user.memberId,
      isAdmin: user.isAdmin,
    });
  }

  @Put(':id')
  @RequirePermission('items.manage')
  rename(@Param('id') id: string, @Body() body: { name?: string }, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.eventTypes.rename(id, body.name ?? '', {
      memberId: user.memberId,
      isAdmin: user.isAdmin,
    });
  }

  @Delete(':id')
  @RequirePermission('items.manage')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.eventTypes.remove(id, {
      memberId: user.memberId,
      isAdmin: user.isAdmin,
    });
  }
}
