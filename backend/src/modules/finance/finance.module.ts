import { Module } from '@nestjs/common';
import { FinanceCalcService } from './finance-calc.service.js';

// PRD 15.1 的唯一計算服務：accounts、goals（D）、dashboard 都從這裡拿數字
@Module({
  providers: [FinanceCalcService],
  exports: [FinanceCalcService],
})
export class FinanceModule {}
