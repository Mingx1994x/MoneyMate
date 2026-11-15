import { Prisma } from '../../prisma/index.js';
import { NextStepType } from './dto/dashboard-section.enum.js';

/** 判斷「一句下一步」需要的資料；金額都是 Prisma.Decimal */
export interface NextStepInput {
  /** 逾期未繳帳單的張數 */
  overdueCount: number;
  /** 14 天資金缺口，> 0 才有值（PRD 15.5） */
  fundingGap: Prisma.Decimal | null;
  /** 目標進度；沒有目標（還沒完成問卷）時是 null */
  goal: {
    achieved: boolean;
    nextMilestone: { index: number; remaining: Prisma.Decimal } | null;
  } | null;
}

export interface NextStep {
  type: NextStepType;
  message: string;
  amount: Prisma.Decimal | null;
}

/**
 * PRD 15.5：依序判斷，第一個符合的就顯示，永遠只有一句。
 * ① 有逾期未繳帳單 ② 14 天資金缺口 > 0 ③ 有目標：下一站（已達成時 goal_achieved）④ 沒有目標：先做問卷。
 * 用語是「提醒而非責備」（PRD 第三節），不寫「你又超支了」這類語氣。
 */
export function decideNextStep(input: NextStepInput): NextStep {
  if (input.overdueCount > 0) {
    return {
      type: NextStepType.overdue_bills,
      message: `有 ${input.overdueCount} 張帳單逾期`,
      amount: null,
    };
  }
  if (input.fundingGap?.gt(0)) {
    return {
      type: NextStepType.funding_gap,
      message: `未來 14 天的已知帳單，整體資金可能不足，差 ${formatTwd(input.fundingGap)} 元`,
      amount: input.fundingGap,
    };
  }
  if (input.goal) {
    const next = input.goal.nextMilestone;
    if (input.goal.achieved || !next) {
      return {
        type: NextStepType.goal_achieved,
        message: '你已經達成財富自由目標了',
        amount: null,
      };
    }
    return {
      type: NextStepType.next_milestone,
      message: `再存 ${formatTwd(next.remaining)} 元就到第 ${next.index} 站`,
      amount: next.remaining,
    };
  }
  return {
    type: NextStepType.onboarding,
    message: '先完成 30 秒問卷',
    amount: null,
  };
}

/** 句子裡的金額：無條件進位到元（還差多少寧可多說一點），加千分位，例如 760000 → 760,000 */
export function formatTwd(d: Prisma.Decimal): string {
  return d
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_UP)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
