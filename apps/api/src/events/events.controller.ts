import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { EventsService } from './events.service';

/**
 * Расписание ивентов (issue #8): чтение — всем членам, создание/серии —
 * офицерам+, редактирование — офицерам или РЛ ивента (проверка в сервисе),
 * статусы — по той же логике, что и ведение ивента.
 */
@Controller('events')
@UseGuards(AuthGuard, PermissionsGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @RequirePermission('members.view_roster')
  list(@Query() query: Record<string, string>) {
    return this.events.list(query);
  }

  @Get(':id')
  @RequirePermission('members.view_roster')
  getOne(@Param('id') id: string) {
    return this.events.getOne(id);
  }

  @Post()
  @RequirePermission('events.manage')
  create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.events.create(body, { memberId: user.memberId, isAdmin: user.isAdmin });
  }

  /** Серия по шаблону: «вт/чт 20:00 × N недель» одним действием. */
  @Post('series')
  @RequirePermission('events.manage')
  createSeries(@Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.events.createSeries(body, { memberId: user.memberId, isAdmin: user.isAdmin });
  }

  /** Удаление серии целиком — только пока все ивенты запланированы. */
  @Delete('series/:seriesId')
  @RequirePermission('events.manage')
  deleteSeries(@Param('seriesId') seriesId: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.events.deleteSeries(seriesId, { memberId: user.memberId, isAdmin: user.isAdmin });
  }

  /**
   * Редактирование: guard пропускает офицеров+; РЛ-не-офицер тоже может —
   * точечная проверка в сервисе (механизм «РЛ ивента», план 2.6).
   */
  @Patch(':id')
  @UseGuards(AuthGuard)
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.events.update(
      id,
      body,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }

  /** Смена статуса: planned → running → finished / cancelled. */
  @Post(':id/status')
  @RequirePermission('events.conduct')
  changeStatus(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    return this.events.changeStatus(id, body, { memberId: user.memberId, isAdmin: user.isAdmin });
  }
}
