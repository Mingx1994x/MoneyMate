import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller.js';
import { LoansService } from './loans.service.js';

// 匯出 LoansService 給 C 的 DashboardModule 用（getLoanSummary）
@Module({
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
