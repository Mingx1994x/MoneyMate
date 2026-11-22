import {
  addDays,
  monthOf,
  monthStart,
  type DateOnly,
  type MonthString,
} from '../../common/date-only.js';
import { Prisma } from '../../prisma/index.js';
import { FinishEstimateStatus } from './dto/fire.enum.js';

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
  months: { income: Prisma.Decimal; expense: Prisma.Decimal }[],
): Prisma.Decimal | null {
  const recorded = months.filter(
    (m) => !m.income.isZero() || !m.expense.isZero(),
  );
  if (recorded.length < MIN_SAVING_MONTHS) return null;
  return recorded
    .reduce(
      (sum, m) => sum.plus(m.income).minus(m.expense),
      new Prisma.Decimal(0),
    )
    .div(recorded.length);
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
