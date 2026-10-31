import { Module } from '@nestjs/common';
import { BillsModule } from '../bills/index.js';
import { FinanceModule } from '../finance/index.js';
import { LoansModule } from '../loans/index.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

// 目標（D 的 GoalsModule、getGoalProgress）在 W4 實作後再接上
@Module({
  imports: [FinanceModule, LoansModule, BillsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
