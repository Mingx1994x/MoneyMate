import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';

// 匯出 BillsService 給 C 的 DashboardModule 用（getBillAlerts）
@Module({
  controllers: [BillsController],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
