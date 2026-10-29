import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/index.js';
import { FinanceModule } from '../finance/index.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

// 匯出 AccountsService 給 D 的 OnboardingModule（createAccount）、E 的 BillsModule
@Module({
  imports: [FinanceModule, CategoriesModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
