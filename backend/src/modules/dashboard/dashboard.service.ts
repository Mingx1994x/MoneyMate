import { Injectable, NotImplementedException } from '@nestjs/common';
import { monthOf, type DateOnly } from '../../common/date-only.js';
import { toMoneyString } from '../../common/money.js';
import { Prisma } from '../../prisma/index.js';
import { BillsService, type BillAlertItem } from '../bills/index.js';
import { FinanceCalcService } from '../finance/index.js';
import { LoansService } from '../loans/index.js';
import { DashboardSection } from './dto/dashboard-section.enum.js';
import type {
  DashboardBillBriefDto,
  DashboardLoansDto,
  DashboardSummaryResponseDto,
} from './dto/dashboard-summary.dto.js';
import { decideNextStep } from './next-step.js';

/** 每個帳單清單在 Dashboard 最多顯示幾筆（PRD 17） */
const BILL_LIST_LIMIT = 5;

@Injectable()
export class DashboardService {
  constructor(
    private readonly finance: FinanceCalcService,
    private readonly loans: LoansService,
    private readonly bills: BillsService,
  ) {}

  /**
   * GET /dashboard/summary。數字一律來自 FinanceCalcService 與各模組的 service（PRD 15.1）。
   * - 分階段交付：E、D 的 service 還沒實作（丟 NotImplementedException）時，那個區塊回 null 並列進 unavailable；
   *   其他錯誤照樣丟出，整支回 500，不回傳部分數字（PRD 18）。
   * - 依賴未完成區塊的數字也回 null：loans 未完成 → netWorth；bills 或 goal 未完成 → nextStep。
   */
  async getSummary(
    userId: string,
    today: DateOnly,
    month: string = monthOf(today),
  ): Promise<DashboardSummaryResponseDto> {
    const unavailable: DashboardSection[] = [];

    const [totals, accountsTotal, cash] = await Promise.all([
      this.finance.getMonthlyTotals(userId, month, today),
      this.finance.getAccountsTotal(userId, today),
      this.finance.getAvailableCash(userId, today),
    ]);

    // ── 帳單（E 的 getBillAlerts）
    const alerts = await whenImplemented(() =>
      this.bills.getBillAlerts(userId, today),
    );
    if (!alerts) unavailable.push(DashboardSection.bills);
    const fundingGap = alerts
      ? calcFundingGap(alerts.dueSoonCount, alerts.dueTotal, cash)
      : null;

    // ── 貸款（E 的 getLoanSummary）與淨資產
    const loanSummary = await whenImplemented(() =>
      this.loans.getLoanSummary(userId, today),
    );
    if (!loanSummary) unavailable.push(DashboardSection.loans);
    const netWorth = loanSummary
      ? await this.finance.getNetWorth(userId, today)
      : null;

    // ── 目標（D 的 getGoalProgress 在 W4 實作，接上前一律 unavailable）
    unavailable.push(DashboardSection.goal);

    // 一句下一步要同時有帳單與目標的資料；目標接上前一律 null（不給可能錯誤的建議）。
    // W4 接上 D 的 getGoalProgress 後，把 goal 換成真的目標進度（沒有目標時是 null → onboarding）。
    const goalReady = !unavailable.includes(DashboardSection.goal);
    const nextStep =
      alerts && goalReady
        ? decideNextStep({
            overdueCount: alerts.overdueCount,
            fundingGap,
            goal: null,
          })
        : null;

    return {
      today,
      month,
      income: toMoneyString(totals.income),
      expense: toMoneyString(totals.expense),
      savingsRate: calcSavingsRate(totals.income, totals.expense),
      accountsTotal: toMoneyString(accountsTotal),
      netWorth: netWorth ? toMoneyString(netWorth) : null,
      availableCash: toMoneyString(cash.total),
      hasCashAccounts: cash.hasCashAccounts,
      billsOverdue: alerts
        ? alerts.overdue.slice(0, BILL_LIST_LIMIT).map(toBillBrief)
        : null,
      billsOverdueCount: alerts ? alerts.overdueCount : null,
      billsDueSoon: alerts
        ? alerts.dueSoon.slice(0, BILL_LIST_LIMIT).map(toBillBrief)
        : null,
      fundingGap: fundingGap ? toMoneyString(fundingGap) : null,
      loans: loanSummary ? toLoansDto(loanSummary) : null,
      goal: null,
      nextStep: nextStep
        ? {
            type: nextStep.type,
            message: nextStep.message,
            amount: nextStep.amount ? toMoneyString(nextStep.amount) : null,
          }
        : null,
      unavailable,
    };
  }
}

/** 呼叫還在空殼階段的 service：丟 NotImplementedException 時回 undefined，其他錯誤照樣丟出 */
async function whenImplemented<T>(
  call: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof NotImplementedException) return undefined;
    throw e;
  }
}

/**
 * 儲蓄率（PRD 15.2）＝（收入 − 支出）÷ 收入 × 100，小數一位、四捨五入只在最後一步；
 * 收入為 0 時回 null（畫面顯示「—」）；可為負。
 */
export function calcSavingsRate(
  income: Prisma.Decimal,
  expense: Prisma.Decimal,
): number | null {
  if (income.isZero()) return null;
  return income
    .minus(expense)
    .div(income)
    .times(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * 14 天資金缺口（PRD 15.5、D-011）＝ 14 天內待繳帳單合計 − 可用現金，> 0 才有值。
 * 沒有啟用的現金／銀行帳戶、或 14 天內沒有待繳帳單時不計算（null）。
 */
export function calcFundingGap(
  dueSoonCount: number,
  dueTotal: Prisma.Decimal,
  cash: { total: Prisma.Decimal; hasCashAccounts: boolean },
): Prisma.Decimal | null {
  if (!cash.hasCashAccounts || dueSoonCount === 0) return null;
  const gap = dueTotal.minus(cash.total);
  return gap.gt(0) ? gap : null;
}

function toBillBrief(b: BillAlertItem): DashboardBillBriefDto {
  return {
    id: b.id,
    name: b.name,
    amount: toMoneyString(b.amount),
    dueDate: b.dueDate,
    daysUntilDue: b.daysUntilDue,
  };
}

function toLoansDto(
  s: Awaited<ReturnType<LoansService['getLoanSummary']>>,
): DashboardLoansDto {
  return {
    outstandingTotal: toMoneyString(s.outstandingTotal),
    activeCount: s.activeCount,
    upcomingPayments: s.upcomingPayments.map((p) => ({
      loanId: p.loanId,
      name: p.name,
      date: p.date,
      monthlyPayment: toMoneyString(p.monthlyPayment),
    })),
  };
}
