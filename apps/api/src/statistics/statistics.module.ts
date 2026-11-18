import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';

@Module({
  controllers: [StatisticsController],
  providers: [StatisticsService, AttendanceStatisticsService],
})
export class StatisticsModule {}
