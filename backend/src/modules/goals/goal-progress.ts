import { Prisma } from '../../prisma/index.js';

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
