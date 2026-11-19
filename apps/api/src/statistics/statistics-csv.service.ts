import { BadRequestException, Injectable } from '@nestjs/common';
import {
  activityCsv,
  attendanceCsv,
  csvMoscowDate,
  dkpCsv,
  gearScoreCsv,
  lootCsv,
  overviewItemsCsv,
  overviewTopCsv,
  statisticsQuerySchema,
  type ActivityCsvTable,
  type AttendanceCsvCut,
  type DkpCsvTable,
  type LootCsvTable,
  type OverviewCsvTable,
} from '@dkp/shared';
import type { PermissionActor } from '@dkp/shared';
import { ActivityStatisticsService } from './activity-statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';
import { DkpStatisticsService } from './dkp-statistics.service';
import { GearScoreStatisticsService } from './gear-score-statistics.service';
import { LootStatisticsService } from './loot-statistics.service';
import { StatisticsService } from './statistics.service';

/**
 * CSV-экспорт таблиц статистики (#223): те же отчёты и права, что в JSON —
 * серверная выборка целиком, а не видимая страница. Ответ — файл c BOM.
 * Защищённый GS-экспорт повторно проверяет право актора (план 2.5).
 */
@Injectable()
export class StatisticsCsvService {
  constructor(
    private readonly statistics: StatisticsService,
    private readonly attendanceStatistics: AttendanceStatisticsService,
    private readonly activityStatistics: ActivityStatisticsService,
    private readonly dkpStatistics: DkpStatisticsService,
    private readonly lootStatistics: LootStatisticsService,
    private readonly gearScoreStatistics: GearScoreStatisticsService,
  ) {}

  async attendance(rawQuery: Record<string, string>): Promise<CsvFile> {
    const cut = parseCut<AttendanceCsvCut>(rawQuery.cut, [
      'members',
      'packs',
      'kps',
      'guild',
      'details',
    ]);
    const query = statisticsQuerySchema.parse(rawQuery);
    const report = await this.attendanceStatistics.get(query);
    return {
      filename: `statistics-attendance-${cut}-${filePeriod(query)}.csv`,
      body: attendanceCsv(report, query, cut),
    };
  }

  async activity(rawQuery: Record<string, string>): Promise<CsvFile> {
    const table = parseCut<ActivityCsvTable>(rawQuery.table, [
      'types',
      'modes',
      'weeks',
      'peak-weekday',
      'peak-hour',
      'members',
      'member-details',
      'events',
    ]);
    const query = statisticsQuerySchema.parse(rawQuery);
    const report = await this.activityStatistics.get(query);
    return {
      filename: `statistics-activity-${table}-${filePeriod(query)}.csv`,
      body: activityCsv(report, query, table),
    };
  }

  async dkp(rawQuery: Record<string, string>): Promise<CsvFile> {
    const table = parseCut<DkpCsvTable>(rawQuery.table, [
      'weeks',
      'members',
      'packs',
      'kps',
      'movements',
      'without-event',
      'without-event-movements',
    ]);
    const query = statisticsQuerySchema.parse(rawQuery);
    const report = await this.dkpStatistics.get(query);
    return {
      filename: `statistics-dkp-${table}-${filePeriod(query)}.csv`,
      body: dkpCsv(report, query, table),
    };
  }

  async loot(rawQuery: Record<string, string>): Promise<CsvFile> {
    const table = parseCut<LootCsvTable>(rawQuery.table, [
      'dropped',
      'dropped-details',
      'awarded',
      'awarded-members',
      'awarded-packs',
      'awarded-kps',
      'without-event-dropped',
      'without-event-awarded',
    ]);
    const query = statisticsQuerySchema.parse(rawQuery);
    const report = await this.lootStatistics.get(query);
    return {
      filename: `statistics-loot-${table}-${filePeriod(query)}.csv`,
      body: lootCsv(report, query, table),
    };
  }

  /** Обзор: рейтинги/типы/предметы; GS-таблица — только Глава/Админ (403). */
  async overview(rawQuery: Record<string, string>, actor: PermissionActor): Promise<CsvFile> {
    const table = parseCut<OverviewCsvTable>(rawQuery.table, [
      'top',
      'types',
      'items',
      'gear-score',
    ]);
    const query = statisticsQuerySchema.parse(rawQuery);
    if (table === 'gear-score') {
      const report = await this.gearScoreStatistics.get(query, actor);
      return {
        filename: `statistics-gear-score-${filePeriod(query)}.csv`,
        body: gearScoreCsv(report, query),
      };
    }
    if (table === 'items') {
      const report = await this.lootStatistics.get(query);
      return {
        filename: `statistics-items-${filePeriod(query)}.csv`,
        body: overviewItemsCsv(report, query),
      };
    }
    if (table === 'types') {
      const report = await this.activityStatistics.get(query);
      return {
        filename: `statistics-types-${filePeriod(query)}.csv`,
        body: activityCsv(report, query, 'types'),
      };
    }
    const report = await this.attendanceStatistics.get(query);
    return {
      filename: `statistics-top-${filePeriod(query)}.csv`,
      body: overviewTopCsv(report, query),
    };
  }
}

export interface CsvFile {
  filename: string;
  body: string;
}

function parseCut<T extends string>(value: string | undefined, allowed: T[]): T {
  const picked = allowed.find((option) => option === value);
  if (!picked) throw new BadRequestException(`Укажите таблицу выгрузки: ${allowed.join(', ')}`);
  return picked;
}

function filePeriod(query: { from?: string; to?: string }): string {
  if (query.from && query.to) {
    return `${csvMoscowDate(`${query.from}T00:00:00Z`)}-${csvMoscowDate(`${query.to}T00:00:00Z`)}`;
  }
  return 'current-month';
}
