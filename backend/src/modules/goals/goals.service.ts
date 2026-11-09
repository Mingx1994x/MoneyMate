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
import type { GoalDto } from './dto/goal.dto.js';
import type { UpdateGoalDto } from './dto/update-goal.dto.js';

/** 目標金額 ＝ 每月花費 × 300（PRD 15.3：4% 提領率，× 12 ÷ 4%） */
export const TARGET_MULTIPLIER = 300;

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

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
