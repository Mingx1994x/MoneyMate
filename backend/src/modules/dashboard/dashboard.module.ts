import { Module } from '@nestjs/common';
import { BillsModule } from '../bills/index.js';
import { FinanceModule } from '../finance/index.js';
import { GoalsModule } from '../goals/index.js';
import { LoansModule } from '../loans/index.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [FinanceModule, LoansModule, BillsModule, GoalsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
