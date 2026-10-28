import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';

// DashboardService 在實作 PR 加入：呼叫 FinanceCalcService（C）、getGoalProgress（D）、getLoanSummary／getBillAlerts（E）
@Module({
  controllers: [DashboardController],
})
export class DashboardModule {}
