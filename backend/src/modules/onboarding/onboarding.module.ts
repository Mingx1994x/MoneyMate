import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller.js';

// OnboardingService 在 W4 實作時加入（呼叫 C 的 createAccount、goals 的建立目標）
@Module({
  controllers: [OnboardingController],
})
export class OnboardingModule {}
