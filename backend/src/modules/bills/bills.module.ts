import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/index.js';
import { CategoriesModule } from '../categories/index.js';
import { TransactionsModule } from '../transactions/index.js';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';

// 匯出 BillsService 給 C 的 DashboardModule 用（getBillAlerts）；帳戶、分類的檢查與繳費的支出用 C 的 service
@Module({
  imports: [AccountsModule, CategoriesModule, TransactionsModule],
  controllers: [BillsController],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
