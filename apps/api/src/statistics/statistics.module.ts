import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';
import { ActivityStatisticsService } from './activity-statistics.service';
import { DkpStatisticsService } from './dkp-statistics.service';
import { LootStatisticsService } from './loot-statistics.service';

@Module({
  controllers: [StatisticsController],
  providers: [
    StatisticsService,
    AttendanceStatisticsService,
    ActivityStatisticsService,
    DkpStatisticsService,
    LootStatisticsService,
  ],
})
export class StatisticsModule {}
