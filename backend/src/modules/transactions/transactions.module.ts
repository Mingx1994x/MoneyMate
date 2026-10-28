import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller.js';

// TransactionsService 在實作 PR 加入（含給 E 用的 createBillTransaction／deleteBillTransaction）
@Module({
  controllers: [TransactionsController],
})
export class TransactionsModule {}
