import { Injectable } from '@nestjs/common';
import { fromDbDate, type DateOnly } from '../../common/date-only.js';
import { LoanStatus, PrismaService } from '../../prisma/index.js';
import { summarizeLoans } from './loan-summary.js';
import type { LoanSummary } from './loan-summary.types.js';

/**
 * 端點的 service 方法在 LOAN-2～4 加入。
 */
@Injectable()
export class LoansService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dashboard 的貸款摘要（LOAN-5，規則見 loan-summary.types.ts）。today 由呼叫端用 ClockService 取得，這裡不取時間。
   * 只讀這位使用者 active 的貸款；計算在 summarizeLoans。
   */
  async getLoanSummary(userId: string, today: DateOnly): Promise<LoanSummary> {
    const rows = await this.prisma.loan.findMany({
      where: { userId, status: LoanStatus.active },
      select: {
        id: true,
        name: true,
        outstandingBalance: true,
        monthlyPayment: true,
        paymentDay: true,
        endDate: true,
      },
    });
    return summarizeLoans(
      rows.map((r) => ({ ...r, endDate: fromDbDate(r.endDate) })),
      today,
    );
  }
}
