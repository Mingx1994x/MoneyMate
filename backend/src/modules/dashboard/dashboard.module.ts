import { Module } from '@nestjs/common';
import { BillsModule } from '../bills/index.js';
import { FinanceModule } from '../finance/index.js';
import { GoalsModule } from '../goals/index.js';
import { LoansModule } from '../loans/index.js';
import { DashboardLayoutController } from './dashboard-layout.controller.js';
import { DashboardLayoutService } from './dashboard-layout.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [FinanceModule, LoansModule, BillsModule, GoalsModule],
  controllers: [DashboardController, DashboardLayoutController],
  providers: [DashboardService, DashboardLayoutService],
})
export class DashboardModule {}
