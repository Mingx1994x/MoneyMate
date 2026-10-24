import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller.js';

// LoansService 在 LOAN-2 實作時加入
@Module({
  controllers: [LoansController],
})
export class LoansModule {}
