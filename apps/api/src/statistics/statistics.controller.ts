import { Controller, Get, Header, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';
import { ActivityStatisticsService } from './activity-statistics.service';
import { DkpStatisticsService } from './dkp-statistics.service';
import { LootStatisticsService } from './loot-statistics.service';
import { GearScoreStatisticsService } from './gear-score-statistics.service';
import { StatisticsCsvService } from './statistics-csv.service';

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
    private readonly csv: StatisticsCsvService,
  ) {}

  /** Защищённый блок GS (план 2.5/2.8): доступ проверяет сервис по актору. */
  @Get('gear-score')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  gearScore(@Query() query: Record<string, string>, @Req() req: AuthedRequest) {
    return this.gearScoreStatistics.get(query, req.session!.user!);
  }

  /** Параметры фильтров: паки КП включают исторические связки (#250). */
  @Get('filter-options')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  filterOptions() {
    return this.statistics.filterOptions();
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

  // CSV-экспорт (#223): те же права и выборка, что у JSON-отчётов; файл с BOM.
  @Get('attendance/export.csv')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  exportAttendanceCsv(@Query() query: Record<string, string>, @Res() res: Response) {
    return this.serveCsv(() => this.csv.attendance(query), res);
  }

  @Get('activity/export.csv')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  exportActivityCsv(@Query() query: Record<string, string>, @Res() res: Response) {
    return this.serveCsv(() => this.csv.activity(query), res);
  }

  @Get('dkp/export.csv')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  exportDkpCsv(@Query() query: Record<string, string>, @Res() res: Response) {
    return this.serveCsv(() => this.csv.dkp(query), res);
  }

  @Get('loot/export.csv')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  exportLootCsv(@Query() query: Record<string, string>, @Res() res: Response) {
    return this.serveCsv(() => this.csv.loot(query), res);
  }

  /** GS-экспорт повторно проверяет право актора в сервисе (план 2.5). */
  @Get('export.csv')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermission('members.view_roster')
  exportOverviewCsv(
    @Query() query: Record<string, string>,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    return this.serveCsv(() => this.csv.overview(query, req.session!.user!), res);
  }

  private async serveCsv(build: () => Promise<{ filename: string; body: string }>, res: Response) {
    const file = await build();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    // BOM нужен табличным редакторам для корректной кириллицы.
    res.send(`\uFEFF${file.body}`);
  }
}
