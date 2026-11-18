import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';

@Controller('statistics')
@UseGuards(AuthGuard, PermissionsGuard)
export class StatisticsController {
  constructor(
    private readonly statistics: StatisticsService,
    private readonly attendanceStatistics: AttendanceStatisticsService,
  ) {}

  @Get('attendance')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  attendance(@Query() query: Record<string, string>) {
    return this.attendanceStatistics.get(query);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  get(@Query() query: Record<string, string>) {
    return this.statistics.get(query);
  }
}
