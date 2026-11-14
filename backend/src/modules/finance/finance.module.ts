import { Module } from '@nestjs/common';
import { LoansModule } from '../loans/index.js';
import { FinanceCalcService } from './finance-calc.service.js';

// PRD 15.1 的唯一計算服務：accounts、goals（D）、dashboard 都從這裡拿數字
@Module({
  imports: [LoansModule],
  providers: [FinanceCalcService],
  exports: [FinanceCalcService],
})
export class FinanceModule {}
