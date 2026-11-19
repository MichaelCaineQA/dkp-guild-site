import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';
import { ActivityStatisticsService } from './activity-statistics.service';
import { DkpStatisticsService } from './dkp-statistics.service';
import { LootStatisticsService } from './loot-statistics.service';
import { GearScoreStatisticsService } from './gear-score-statistics.service';

@Controller('statistics')
@UseGuards(AuthGuard, PermissionsGuard)
export class StatisticsController {
  constructor(
    private readonly statistics: StatisticsService,
    private readonly attendanceStatistics: AttendanceStatisticsService,
    private readonly activityStatistics: ActivityStatisticsService,
    private readonly dkpStatistics: DkpStatisticsService,
    private readonly lootStatistics: LootStatisticsService,
    private readonly gearScoreStatistics: GearScoreStatisticsService,
  ) {}

  /** Защищённый блок GS (план 2.5/2.8): доступ проверяет сервис по актору. */
  @Get('gear-score')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  gearScore(@Query() query: Record<string, string>, @Req() req: AuthedRequest) {
    return this.gearScoreStatistics.get(query, req.session!.user!);
  }

  @Get('attendance')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  attendance(@Query() query: Record<string, string>) {
    return this.attendanceStatistics.get(query);
  }

  @Get('dkp')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  dkp(@Query() query: Record<string, string>) {
    return this.dkpStatistics.get(query);
  }

  @Get('loot')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  loot(@Query() query: Record<string, string>) {
    return this.lootStatistics.get(query);
  }

  @Get('activity')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  activity(@Query() query: Record<string, string>) {
    return this.activityStatistics.get(query);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  get(@Query() query: Record<string, string>) {
    return this.statistics.get(query);
  }
}
