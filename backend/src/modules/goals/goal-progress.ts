import {
  addDays,
  monthOf,
  monthStart,
  type DateOnly,
  type MonthString,
} from '../../common/date-only.js';
import { Prisma } from '../../prisma/index.js';
import { EmergencyFundStatus, FinishEstimateStatus } from './dto/fire.enum.js';

/**
 * 目標進度的純函式（PRD 15.3、15.4）：只算數字，不讀資料庫。
 * 目標金額、目前金額（帳戶合計）由呼叫的 service 準備好再傳進來。
 */

/** 里程碑候選站（PRD 15.4），目標 ÷ 2 由 buildMilestones 加入；依這個順序列，重複時留先列的 */
const FIXED_STATIONS = [
  { amount: new Prisma.Decimal(100000), label: '緊急預備金' },
  { amount: new Prisma.Decimal(1000000), label: '第一桶金' },
] as const;

export interface Milestone {
  /** 第幾站，從 1 開始 */
  index: number;
  amount: Prisma.Decimal;
  label: string;
  /** 目前金額 ≥ 這一站 */
  reached: boolean;
}

export interface NextMilestone extends Milestone {
  /** 再存多少就到這一站，> 0 */
  remaining: Prisma.Decimal;
}

export interface MilestonesResult {
  /** 由小到大，最後一站是目標金額 */
  milestones: Milestone[];
  /** 下一個還沒到的站；全部達成時是 null */
  next: NextMilestone | null;
}

/**
 * 里程碑（PRD 15.4）：
 * 1. 候選站：10 萬（緊急預備金）、100 萬（第一桶金）、目標 ÷ 2（一半）。
 * 2. 由小到大排序，刪掉 ≥ 目標的站，金額重複的只留一個（留先列的）。
 * 3. 最後加上終點（財富自由＝目標金額）。
 */
export function buildMilestones(
  target: Prisma.Decimal,
  current: Prisma.Decimal,
): MilestonesResult {
  const candidates = [
    ...FIXED_STATIONS,
    { amount: target.div(2), label: '一半' },
  ]
    .filter((s) => s.amount.lt(target))
    // sort 是穩定排序：金額相同時維持候選順序，下面留下先列的那一站
    .sort((a, b) => a.amount.comparedTo(b.amount))
    .filter((s, i, all) => i === 0 || !s.amount.eq(all[i - 1].amount));

  const milestones = [...candidates, { amount: target, label: '財富自由' }].map(
    (s, i) => ({
      index: i + 1,
      amount: s.amount,
      label: s.label,
      reached: current.gte(s.amount),
    }),
  );

  const first = milestones.find((m) => !m.reached);
  return {
    milestones,
    next: first ? { ...first, remaining: first.amount.minus(current) } : null,
  };
}

/**
 * 達成百分比（PRD 15.3）：目前 ÷ 目標，四捨五入到小數一位；≤ 0 時 0，≥ 目標時 100。
 * 還沒達成時最多 99.9：四捨五入成 100 會讓畫面寫 100% 卻沒有「已達成」。
 */
export function goalPercent(
  target: Prisma.Decimal,
  current: Prisma.Decimal,
): number {
  if (current.lte(0)) return 0;
  if (current.gte(target)) return 100;
  const percent = current
    .div(target)
    .times(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP);
  return Math.min(percent.toNumber(), 99.9);
}

/** 至少要幾個有記帳的完整月，才用實際的平均儲蓄（PRD 15.7） */
export const MIN_SAVING_MONTHS = 3;
/** 最多看最近幾個完整月（PRD 15.7） */
export const MAX_SAVING_MONTHS = 6;

/** 最近 n 個完整月（不含 today 所在的月），由近到遠，例：2026-11-11、3 → 2026-10、2026-09、2026-08 */
export function recentCompleteMonths(
  today: DateOnly,
  n: number,
): MonthString[] {
  const months: MonthString[] = [];
  let month = monthOf(today);
  for (let i = 0; i < n; i++) {
    month = monthOf(addDays(monthStart(month), -1));
    months.push(month);
  }
  return months;
}

/**
 * 每月平均儲蓄（PRD 15.7）：傳入最近最多 6 個完整月的收入、支出合計。
 * 有記帳的月（收入或支出不是 0）才算；不滿 3 個月回 null（改用自估值）。
 * 沒記帳的月不當成存 0，不然忘了記帳的月會把平均拉低。保留完整精度，不四捨五入。
 */
export function averageMonthlySaving(
  months: MonthTotals[],
): Prisma.Decimal | null {
  return averageOfRecorded(months, (m) => m.income.minus(m.expense));
}

/**
 * 每月平均支出（緊急預備金 D-A-006、建議目標 D-A-007）：和 averageMonthlySaving 同一組月份、同一個規則，
 * 有記帳的月不滿 3 個回 null。保留完整精度，不四捨五入。
 */
export function averageMonthlyExpense(
  months: MonthTotals[],
): Prisma.Decimal | null {
  return averageOfRecorded(months, (m) => m.expense);
}

type MonthTotals = { income: Prisma.Decimal; expense: Prisma.Decimal };

/** 只看有記帳的月（收入或支出不是 0），不滿 MIN_SAVING_MONTHS 個回 null，否則回 pick 的平均 */
function averageOfRecorded(
  months: MonthTotals[],
  pick: (m: MonthTotals) => Prisma.Decimal,
): Prisma.Decimal | null {
  const recorded = months.filter(
    (m) => !m.income.isZero() || !m.expense.isZero(),
  );
  if (recorded.length < MIN_SAVING_MONTHS) return null;
  return recorded
    .reduce((sum, m) => sum.plus(pick(m)), new Prisma.Decimal(0))
    .div(recorded.length);
}

export interface EmergencyFund {
  status: EmergencyFundStatus;
  /** 可撐幾個月，小數一位（無條件捨去）；status 不是 ok 時是 null */
  months: number | null;
}

/**
 * 緊急預備金夠幾個月（D-A-006）：可撐月數 ＝ 可用現金 ÷ 平均每月支出。
 * - 沒有啟用中的現金、銀行帳戶 → no_cash_account，不說成「撐 0 個月」（和 14 天資金缺口一樣，AC-20）。
 * - 平均每月支出 null（有記帳的完整月不滿 3 個）→ need_data。
 * - 平均每月支出 ≤ 0（只有收入沒有支出）→ no_expense，除以 0 沒有意義。
 * - 可用現金 ≤ 0 → 0 個月。無條件捨去到小數一位，不把「撐 2.96 個月」說成 3 個月。
 */
export function estimateEmergencyFund(
  cash: { total: Prisma.Decimal; hasCashAccounts: boolean },
  monthlyExpense: Prisma.Decimal | null,
): EmergencyFund {
  if (!cash.hasCashAccounts) {
    return { status: EmergencyFundStatus.no_cash_account, months: null };
  }
  if (monthlyExpense === null) {
    return { status: EmergencyFundStatus.need_data, months: null };
  }
  if (monthlyExpense.lte(0)) {
    return { status: EmergencyFundStatus.no_expense, months: null };
  }
  if (cash.total.lte(0)) return { status: EmergencyFundStatus.ok, months: 0 };
  return {
    status: EmergencyFundStatus.ok,
    months: cash.total
      .div(monthlyExpense)
      .toDecimalPlaces(1, Prisma.Decimal.ROUND_DOWN)
      .toNumber(),
  };
}

/** 推算達成日最多算幾個月，超過就是「以目前速度超過 50 年」（PRD 15.6） */
export const MAX_FINISH_MONTHS = 600;

export interface FinishEstimate {
  status: FinishEstimateStatus;
  /** 還要幾個月；status 不是 ok 時是 null */
  monthsLeft: number | null;
  /** 預計達成的月份（YYYY-MM）；status 不是 ok 時是 null */
  finishMonth: MonthString | null;
}

/** 月份加 n 個月，例：2026-11 加 3 → 2027-02 */
export function addMonths(month: MonthString, n: number): MonthString {
  const index =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * 推算達成日（PRD 15.6、D-A-004）：只算數字，不讀資料庫。
 * - 每月儲蓄由呼叫的 service 準備：最近完整月的平均，不足 3 個月用自估值；都沒有傳 null（不當成 0）。
 * - 所需月數 ＝（目標 − 目前）÷ 每月儲蓄（四捨五入到 2 位），無條件進位；預計達成月 ＝ 本月 ＋ 所需月數。
 * - 判斷順序：achieved → need_saving → unreachable（儲蓄 ≤ 0）→ over_50_years（> 600 個月）→ ok。
 *   已達成不需要儲蓄資料，所以最先判斷（和財富自由年齡的順序一樣）。
 */
export function estimateFinish(
  target: Prisma.Decimal,
  current: Prisma.Decimal,
  monthlySaving: Prisma.Decimal | null,
  today: DateOnly,
): FinishEstimate {
  const none = { monthsLeft: null, finishMonth: null };
  if (current.gte(target)) {
    return { status: FinishEstimateStatus.achieved, ...none };
  }
  if (monthlySaving === null) {
    return { status: FinishEstimateStatus.need_saving, ...none };
  }
  // 每月儲蓄先四捨五入到 2 位（和回應裡顯示的 monthlySaving 一樣），
  // 這樣「每月存 X 元 × 所需月數」可以用畫面上的數字驗算
  const saving = monthlySaving.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (saving.lte(0)) {
    return { status: FinishEstimateStatus.unreachable, ...none };
  }
  const months = target
    .minus(current)
    .div(saving)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL)
    .toNumber();
  if (months > MAX_FINISH_MONTHS) {
    return { status: FinishEstimateStatus.over_50_years, ...none };
  }
  return {
    status: FinishEstimateStatus.ok,
    monthsLeft: months,
    finishMonth: addMonths(monthOf(today), months),
  };
}

/** 目標金額 ＝ 每月花費 × 300（PRD 15.3：4% 提領率，× 12 ÷ 4%） */
export const TARGET_MULTIPLIER = 300;
/** 每月花費的範圍，UpdateGoalDto（PATCH /goal）用同樣的 @Min、@Max */
export const MIN_MONTHLY_SPENDING = 1000;
export const MAX_MONTHLY_SPENDING = 333000;

export interface TargetSuggestion {
  /** 實際平均每月支出，四捨五入到整數 */
  monthlySpending: Prisma.Decimal;
  /** monthlySpending × 300 */
  targetAmount: Prisma.Decimal;
  /** targetAmount − 目前目標，可為負 */
  difference: Prisma.Decimal;
}

/**
 * 依真實支出建議目標（D-A-007、US-13）：平均每月支出 null（不滿 3 個完整月）→ null，不建議。
 * 每月支出四捨五入到整數再 × 300：前端「一鍵更新」把 monthlySpending 原樣送到 PATCH /goal，
 * 那裡只收 1,000–333,000 的整數，所以超出範圍也回 null（送了會 400）。
 */
export function suggestTarget(
  currentTarget: Prisma.Decimal,
  monthlyExpense: Prisma.Decimal | null,
): TargetSuggestion | null {
  if (monthlyExpense === null) return null;
  const monthlySpending = monthlyExpense.toDecimalPlaces(
    0,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  if (
    monthlySpending.lt(MIN_MONTHLY_SPENDING) ||
    monthlySpending.gt(MAX_MONTHLY_SPENDING)
  ) {
    return null;
  }
  const targetAmount = monthlySpending.times(TARGET_MULTIPLIER);
  return {
    monthlySpending,
    targetAmount,
    difference: targetAmount.minus(currentTarget),
  };
}
