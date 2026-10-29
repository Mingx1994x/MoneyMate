import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/index.js';
import { CategoriesModule } from '../categories/index.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsService } from './transactions.service.js';

// 匯出 TransactionsService 給 E 的帳單（createBillTransaction／deleteBillTransaction 在 W3 加入）
@Module({
  imports: [AccountsModule, CategoriesModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
