import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import {
  AccountType,
  Prisma,
  PrismaService,
  type Goal,
} from '../../prisma/index.js';
import { AccountsService } from '../accounts/index.js';
import { GoalsService } from '../goals/index.js';
import type { CreateOnboardingDto } from './dto/create-onboarding.dto.js';

/** 問卷 Q2 有填時建立的帳戶名稱（D-D-004：一般的銀行帳戶，不是估計帳戶） */
export const SAVINGS_ACCOUNT_NAME = '現有存款';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goals: GoalsService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * 送出問卷（PRD 第十二節、AC-15、D-D-004）：同一個資料庫交易內建立目標與「現有存款」帳戶，任一個失敗就全部不算。
   * - 已經有目標 → 409 ONBOARDING_ALREADY_DONE。
   * - 兩個請求同時送出時，兩邊都會通過上面的檢查；後到的 goals 寫入會等先到的交易結束，
   *   再撞 goals_user_id_key，filter 轉成同一個 409。所以先建目標、再建帳戶。
   * - currentAssets > 0 時建立一般的銀行帳戶（不是估計帳戶）；省略、null（跳過 Q2）或 0 時不建帳戶。
   */
  submit(userId: string, dto: CreateOnboardingDto): Promise<Goal> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.goal.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (existing) throw new AppException('ONBOARDING_ALREADY_DONE');

      const goal = await this.goals.createGoal(
        tx,
        userId,
        new Prisma.Decimal(dto.monthlySpending),
      );
      if (dto.currentAssets) {
        await this.accounts.createAccount(tx, userId, {
          name: SAVINGS_ACCOUNT_NAME,
          accountType: AccountType.bank,
          openingBalance: new Prisma.Decimal(dto.currentAssets),
        });
      }
      return goal;
    });
  }
}
