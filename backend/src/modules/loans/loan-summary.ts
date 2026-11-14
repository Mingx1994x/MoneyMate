import {
  addDays,
  dayInMonth,
  daysBetween,
  monthOf,
  nextMonthStart,
  type DateOnly,
} from '../../common/date-only.js';
import { Prisma } from '../../prisma/index.js';
import type { LoanSummary, LoanUpcomingPayment } from './loan-summary.types.js';

/** 還款日列入的範圍：今天到今天＋14 天（含頭尾），和帳單的 14 天同一個範圍（D-011） */
const UPCOMING_DAYS = 14;

/** getLoanSummary 需要的欄位。只傳 active 的貸款，由呼叫端過濾 */
export interface ActiveLoan {
  id: string;
  name: string;
  outstandingBalance: Prisma.Decimal;
  monthlyPayment: Prisma.Decimal;
  paymentDay: number;
  endDate: DateOnly;
}

/**
 * 算出 Dashboard 的貸款摘要（規則見 loan-summary.types.ts）。純函式，不讀資料庫、不取時間，方便固定 today 測試。
 * 還款日只算今天所在月與下一個月：範圍只有 15 天，最多跨兩個月；兩個月的還款日相差至少 28 天，同一筆貸款最多列一次。
 */
export function summarizeLoans(
  loans: readonly ActiveLoan[],
  today: DateOnly,
): LoanSummary {
  const last = addDays(today, UPCOMING_DAYS);
  const thisMonth = monthOf(today);
  const months = [thisMonth, monthOf(nextMonthStart(thisMonth))];

  const upcomingPayments: LoanUpcomingPayment[] = [];
  for (const loan of loans) {
    for (const m of months) {
      const date = dayInMonth(m, loan.paymentDay);
      // 晚於結清日的還款日不列（Q10）
      if (date < today || date > last || date > loan.endDate) continue;
      upcomingPayments.push({
        loanId: loan.id,
        name: loan.name,
        date,
        monthlyPayment: loan.monthlyPayment,
        daysUntilDue: daysBetween(today, date),
      });
    }
  }
  upcomingPayments.sort(
    (a, b) =>
      compare(a.date, b.date) ||
      compare(a.name, b.name) ||
      compare(a.loanId, b.loanId),
  );

  return {
    activeCount: loans.length,
    outstandingTotal: loans.reduce(
      (sum, l) => sum.plus(l.outstandingBalance),
      new Prisma.Decimal(0),
    ),
    upcomingPayments,
  };
}

// 用字元碼比較，不用 localeCompare：結果不受執行環境的語系影響
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
