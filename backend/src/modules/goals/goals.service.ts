import { Injectable } from '@nestjs/common';
import { Prisma, type Goal, type PrismaTx } from '../../prisma/index.js';

/** 目標金額 ＝ 每月花費 × 300（PRD 15.3：4% 提領率，× 12 ÷ 4%） */
export const TARGET_MULTIPLIER = 300;

@Injectable()
export class GoalsService {
  /**
   * 建立目標（給問卷用，跨模組寫入，不另開交易）。targetAmount 只在這裡算（data-dictionary）。
   * 同一位使用者已經有目標時，goals_user_id_key 會擋下，filter 轉成 409 ONBOARDING_ALREADY_DONE。
   */
  createGoal(
    tx: PrismaTx,
    userId: string,
    monthlySpending: Prisma.Decimal,
  ): Promise<Goal> {
    return tx.goal.create({
      data: {
        userId,
        monthlySpending,
        targetAmount: monthlySpending.times(TARGET_MULTIPLIER),
      },
    });
  }
}
