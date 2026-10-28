import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller.js';

// GoalsService（含 getGoalProgress，給 C 的 Dashboard 用）在 W4 實作時加入
@Module({
  controllers: [GoalsController],
})
export class GoalsModule {}
