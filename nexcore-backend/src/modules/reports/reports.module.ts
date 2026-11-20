import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { MonitoringController } from './monitoring.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController, MonitoringController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
