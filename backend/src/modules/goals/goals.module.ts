import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/index.js';
import { LoansModule } from '../loans/index.js';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';

// 匯出 GoalsService 給 D 的 OnboardingModule（createGoal、getGoalProgress）與 C 的 Dashboard（getGoalProgress）
@Module({
  imports: [FinanceModule, LoansModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
