import { Injectable } from '@nestjs/common';
import { addYears, fromDbDate, type DateOnly } from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { toMoney, toMoneyString } from '../../common/money.js';
import { LoanStatus, PrismaService } from '../../prisma/index.js';
import type {
  LoanPaymentPreviewQueryDto,
  LoanPaymentPreviewResponseDto,
} from './dto/loan-payment-preview.dto.js';
import { calcLoanPayment, countInstallments } from './loan-payment.js';
import { summarizeLoans } from './loan-summary.js';
import type { LoanSummary } from './loan-summary.types.js';

/** 結清日最晚到台北今天加幾年（Q12） */
const LOAN_END_DATE_MAX_YEARS = 50;

/**
 * 貸款。LOAN-4 試算、LOAN-5 getLoanSummary 已實作；CRUD 在 LOAN-2 實作。
 * today 一律由呼叫端用 ClockService 取得，這裡不取時間。
 */
@Injectable()
export class LoansService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /loans/payment-preview（PRD 15.8、D-E-002）。只計算，不讀寫資料庫。
   * 結清日晚於今天加 50 年回 VALIDATION_FAILED（endDate）；早於今天不擋，期數視為 1。
   */
  paymentPreview(
    query: LoanPaymentPreviewQueryDto,
    today: DateOnly,
  ): LoanPaymentPreviewResponseDto {
    assertEndDateNotTooFar(query.endDate, today);
    const installments = countInstallments(
      today,
      query.paymentDay,
      query.endDate,
    );
    const { monthlyPayment, totalInterest } = calcLoanPayment({
      balance: toMoney(query.outstandingBalance),
      annualRatePercent: query.interestRate,
      installments,
    });
    return {
      monthlyPayment: toMoneyString(monthlyPayment),
      totalInterest: toMoneyString(totalInterest),
      installments,
    };
  }

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

/** 結清日不可晚於台北今天加 50 年（Q12）；試算、新增、修改共用 */
function assertEndDateNotTooFar(endDate: DateOnly, today: DateOnly): void {
  if (endDate > addYears(today, LOAN_END_DATE_MAX_YEARS)) {
    throw AppException.forField('VALIDATION_FAILED', 'endDate');
  }
}
