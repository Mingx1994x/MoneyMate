import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/index.js';
import { GoalsModule } from '../goals/index.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

// 問卷呼叫 C 的 createAccount 與 goals 的 createGoal；端點回傳 goals 的 getGoalProgress
@Module({
  imports: [AccountsModule, GoalsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
