import { Injectable } from '@nestjs/common';
import type { DateOnly } from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { toMoney, toMoneyString } from '../../common/money.js';
import {
  Prisma,
  PrismaService,
  type Goal,
  type PrismaTx,
} from '../../prisma/index.js';
import { FinanceCalcService } from '../finance/index.js';
import { LoansService } from '../loans/index.js';
import { SavingSource } from './dto/fire.enum.js';
import type { GoalProgressDto } from './dto/goal-progress.dto.js';
import type { GoalDto } from './dto/goal.dto.js';
import type { UpdateGoalDto } from './dto/update-goal.dto.js';
import { calculateFireAge } from './fire-age.js';
import {
  averageMonthlySaving,
  buildMilestones,
  goalPercent,
  MAX_SAVING_MONTHS,
  recentCompleteMonths,
  type Milestone,
} from './goal-progress.js';

/** 目標金額 ＝ 每月花費 × 300（PRD 15.3：4% 提領率，× 12 ÷ 4%） */
export const TARGET_MULTIPLIER = 300;

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceCalcService,
    private readonly loans: LoansService,
  ) {}

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

  /** GET /goal：還沒完成問卷（沒有目標）回 409 ONBOARDING_REQUIRED */
  async findOne(userId: string): Promise<GoalDto> {
    const goal = await this.prisma.goal.findUnique({ where: { userId } });
    if (!goal) throw new AppException('ONBOARDING_REQUIRED');
    return toResponse(goal);
  }

  /**
   * PATCH /goal：只寫有傳的欄位；null 代表清空（monthlySpending 的 null 由 DTO 擋下）。
   * 改了 monthlySpending 就一起重算 targetAmount。birthYear 不能晚於台北的今年。
   */
  async update(
    userId: string,
    dto: UpdateGoalDto,
    today: DateOnly,
  ): Promise<GoalDto> {
    if (
      dto.birthYear !== undefined &&
      dto.birthYear !== null &&
      dto.birthYear > Number(today.slice(0, 4))
    ) {
      throw AppException.forField('VALIDATION_FAILED', 'birthYear');
    }

    const data: Prisma.GoalUpdateManyMutationInput = {};
    if (dto.monthlySpending !== undefined) {
      const monthlySpending = new Prisma.Decimal(dto.monthlySpending);
      data.monthlySpending = monthlySpending;
      data.targetAmount = monthlySpending.times(TARGET_MULTIPLIER);
    }
    if (dto.birthYear !== undefined) data.birthYear = dto.birthYear;
    if (dto.estMonthlySaving !== undefined) {
      data.estMonthlySaving =
        dto.estMonthlySaving === null ? null : toMoney(dto.estMonthlySaving);
    }

    return this.prisma.$transaction(async (tx) => {
      // updateMany 帶 userId 再看 count：沒有目標時不會撞到 P2025（README「錯誤處理」）
      const { count } = await tx.goal.updateMany({ where: { userId }, data });
      if (count === 0) throw new AppException('ONBOARDING_REQUIRED');
      return toResponse(await tx.goal.findUniqueOrThrow({ where: { userId } }));
    });
  }

  /**
   * 目標進度＋財富自由年齡（GET /goal/progress、POST /onboarding 的回應，PRD 15.3、15.4、15.7）。
   * 數字都來自 C 的 FinanceCalcService 與 E 的 getLoanSummary（PRD 15.1），這裡不另外寫公式。
   * - 目前金額 ＝ 帳戶合計（啟用帳戶、含估計帳戶與信用卡負值、不扣貸款、不含未來交易）。
   * - 年儲蓄：最近 6 個完整月裡有記帳的月 ≥ 3 個 → 那些月的平均（收入 − 支出）× 12（actual）；
   *   否則用 estMonthlySaving × 12（estimate）；都沒有是 null。
   * - 還沒完成問卷 → 409 ONBOARDING_REQUIRED。
   */
  async getGoalProgress(
    userId: string,
    today: DateOnly,
  ): Promise<GoalProgressDto> {
    const goal = await this.prisma.goal.findUnique({ where: { userId } });
    if (!goal) throw new AppException('ONBOARDING_REQUIRED');

    const [current, loanSummary, ...months] = await Promise.all([
      this.finance.getAccountsTotal(userId, today),
      this.loans.getLoanSummary(userId, today),
      ...recentCompleteMonths(today, MAX_SAVING_MONTHS).map((month) =>
        this.finance.getMonthlyTotals(userId, month, today),
      ),
    ]);

    const target = goal.targetAmount;
    const { milestones, next } = buildMilestones(target, current);

    const actualSaving = averageMonthlySaving(months);
    const monthlySaving = actualSaving ?? goal.estMonthlySaving;
    const savingSource =
      actualSaving !== null
        ? SavingSource.actual
        : goal.estMonthlySaving !== null
          ? SavingSource.estimate
          : null;
    const annualSaving =
      monthlySaving === null ? null : monthlySaving.times(12);
    const annualSpending = goal.monthlySpending.times(12);
    const age =
      goal.birthYear === null
        ? null
        : Number(today.slice(0, 4)) - goal.birthYear;

    const fire = calculateFireAge({
      annualSpending,
      annualSaving,
      currentAssets: current,
      age,
    });

    const remaining = target.minus(current);
    return {
      targetAmount: toMoneyString(target),
      currentAmount: toMoneyString(current),
      remaining: toMoneyString(
        remaining.gt(0) ? remaining : new Prisma.Decimal(0),
      ),
      percent: goalPercent(target, current),
      achieved: current.gte(target),
      milestones: milestones.map(toMilestoneDto),
      nextMilestone: next
        ? {
            ...toMilestoneDto(next),
            remaining: toMoneyString(round2(next.remaining)),
          }
        : null,
      fireAge: fire.status === 'ok' ? fire.age : null,
      fireAgeStatus: fire.status,
      fireAssumptions: {
        annualSpending: toMoneyString(annualSpending),
        annualSaving:
          annualSaving === null ? null : toMoneyString(round2(annualSaving)),
        savingSource,
        currentAssets: toMoneyString(current),
        age,
      },
      activeLoanTotal: toMoneyString(loanSummary.outstandingTotal),
    };
  }
}

/** 金額顯示用：四捨五入到 2 位（計算過程保留完整精度，只在最後一步進位） */
const round2 = (d: Prisma.Decimal): Prisma.Decimal =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

function toMilestoneDto(m: Milestone) {
  return {
    index: m.index,
    amount: toMoneyString(round2(m.amount)),
    label: m.label,
    reached: m.reached,
  };
}

function toResponse(goal: Goal): GoalDto {
  return {
    name: goal.name,
    monthlySpending: toMoneyString(goal.monthlySpending),
    targetAmount: toMoneyString(goal.targetAmount),
    birthYear: goal.birthYear,
    estMonthlySaving:
      goal.estMonthlySaving === null
        ? null
        : toMoneyString(goal.estMonthlySaving),
  };
}
