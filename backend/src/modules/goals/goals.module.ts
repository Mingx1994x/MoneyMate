import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller.js';
import { GoalsService } from './goals.service.js';

// 匯出 GoalsService 給 D 的 OnboardingModule（createGoal）；getGoalProgress（給 C 的 Dashboard）之後加入
@Module({
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
