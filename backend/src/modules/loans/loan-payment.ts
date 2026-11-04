import {
  dayInMonth,
  monthOf,
  monthStart,
  nextMonthStart,
  type DateOnly,
} from '../../common/date-only.js';
import { Prisma } from '../../prisma/index.js';

/**
 * 剩餘期數（D-E-002）：台北今天（含）到 endDate（含）之間的還款日個數，至少 1。
 * - 每月還款日 ＝ paymentDay，29–31 遇短月用當月最後一天（PRD 16.4）。
 * - 本月的還款日已過就從下個月算；今天剛好是還款日時算一期。
 * - 晚於 endDate 的還款日不算（跟 Dashboard 不列結清日之後的還款日一致，Q10）。
 * - endDate 早於今天時回 1，不丟錯（前端這種情況不會呼叫試算）。
 * 純函式：today 由呼叫端用 ClockService 取得。
 */
export function countInstallments(
  today: DateOnly,
  paymentDay: number,
  endDate: DateOnly,
): number {
  let n = 0;
  for (
    let m = monthOf(today);
    monthStart(m) <= endDate;
    m = monthOf(nextMonthStart(m))
  ) {
    const date = dayInMonth(m, paymentDay);
    if (date >= today && date <= endDate) n++;
  }
  return Math.max(n, 1);
}

export interface LoanPaymentInput {
  /** 未償餘額 */
  balance: Prisma.Decimal;
  /** 年利率 %，3 代表 3% */
  annualRatePercent: Prisma.Decimal | number;
  /** 剩餘期數，至少 1（countInstallments 的結果） */
  installments: number;
}

/** 還款表的一期（只給測試看，API 不回傳還款表） */
export interface LoanScheduleRow {
  payment: Prisma.Decimal;
  interest: Prisma.Decimal;
  /** 繳完這一期後的剩餘本金 */
  remaining: Prisma.Decimal;
}

/**
 * 本息平均攤還（PRD 15.8）：建議月付與預估總利息。全程 Decimal。
 * - 月利率 r ＝ 年利率 ÷ 100 ÷ 12；月付 ＝ 餘額 × r ÷（1 −（1 ＋ r）⁻ⁿ），年利率 0 時 ＝ 餘額 ÷ n，四捨五入到元。
 * - 總利息 ＝ 逐期利息加總（含最後一期），逐期規則見 loanSchedule。
 * - n ＝ 1 時月付 ＝ 餘額 ＋ 一期利息（就是唯一一期的金額）。
 */
export function calcLoanPayment(input: LoanPaymentInput): {
  monthlyPayment: Prisma.Decimal;
  totalInterest: Prisma.Decimal;
} {
  const schedule = loanSchedule(input);
  return {
    monthlyPayment: schedule[0].payment,
    totalInterest: schedule.reduce(
      (sum, row) => sum.plus(row.interest),
      new Prisma.Decimal(0),
    ),
  };
}

/**
 * 逐期計算（calcLoanPayment 內部用；匯出只為了測試每期剩餘本金）。
 * - 每期利息 ＝ round（剩餘本金 × r），本金 ＝ 月付 − 利息，但不超過剩餘本金（金額很小時，取整後的月付可能提早還完）。
 * - 最後一期 ＝ 剩餘本金 ＋ 最後一期利息，吸收累積尾差，剩餘本金剛好為 0。
 */
export function loanSchedule({
  balance,
  annualRatePercent,
  installments: n,
}: LoanPaymentInput): LoanScheduleRow[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('loanSchedule: 期數必須是 ≥ 1 的整數');
  }
  if (balance.isNegative()) {
    throw new Error('loanSchedule: 餘額不可為負');
  }
  const r = new Prisma.Decimal(annualRatePercent).div(100).div(12);
  const monthly = roundToYuan(
    r.isZero()
      ? balance.div(n)
      : balance.times(r).div(new Prisma.Decimal(1).minus(r.plus(1).pow(-n))),
  );

  const rows: LoanScheduleRow[] = [];
  let remaining = balance;
  for (let i = 1; i <= n; i++) {
    const interest = roundToYuan(remaining.times(r));
    const payment =
      i === n
        ? remaining.plus(interest)
        : Prisma.Decimal.min(monthly, remaining.plus(interest));
    remaining = remaining.minus(payment.minus(interest));
    rows.push({ payment, interest, remaining });
  }
  return rows;
}

function roundToYuan(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
}
