import { Prisma } from '../../prisma/index.js';

/**
 * 財富自由年齡（PRD 15.7）。純函式：只算數字，不讀資料庫、不取今天
 * （年齡、年儲蓄、現在資產都由呼叫的 service 準備好再傳進來）。
 *
 * 全部用「今日幣值」：用實質報酬率逐年模擬，年儲蓄在每年年底一次投入。
 */

/** 提領率 4%：FIRE 目標 ＝ 年支出 ÷ 4% ＝ 年支出 × 25（＝ 每月花費 × 300，和問卷的目標金額同一個基準） */
export const WITHDRAWAL_RATE = new Prisma.Decimal('0.04');
/** 投資報酬率 6%（P0 固定，不做滑桿） */
export const RETURN_RATE = new Prisma.Decimal('0.06');
/** 通膨率 2% */
export const INFLATION_RATE = new Prisma.Decimal('0.02');
/** 超過這個年齡才達成，就算「100 歲前無法達成」 */
export const MAX_AGE = 100;

/** 實質報酬率 ＝（1 ＋ 報酬率）÷（1 ＋ 通膨率）− 1，6% 與 2% 時約 3.92% */
export const REAL_RETURN_RATE = new Prisma.Decimal(1)
  .plus(RETURN_RATE)
  .div(new Prisma.Decimal(1).plus(INFLATION_RATE))
  .minus(1);

/**
 * 狀態值與 API 的 FireAgeStatus 相同（goals/dto/fire.enum.ts）。
 * 判斷順序：achieved → need_birth_year → need_saving → 模擬（unreachable／over_100／ok）。
 * 已達成不需要年齡和儲蓄，所以排在最前面。
 */
export type FireAgeResultStatus =
  | 'ok'
  | 'achieved'
  | 'need_birth_year'
  | 'need_saving'
  | 'unreachable'
  | 'over_100';

export interface FireAgeInput {
  /** 年支出 ＝ 每月花費 × 12 */
  annualSpending: Prisma.Decimal;
  /** 年儲蓄；沒有實際記帳也沒有自估值時是 null。可以是 0 或負數 */
  annualSaving: Prisma.Decimal | null;
  /** 現在資產 ＝ 帳戶合計（未扣貸款），可為負 */
  currentAssets: Prisma.Decimal;
  /** 現在年齡 ＝ 台北的今年 − 出生年；沒有出生年時是 null */
  age: number | null;
}

export interface FireAgeResult {
  status: FireAgeResultStatus;
  /** 財富自由年齡；只有 status 是 ok 時有值 */
  age: number | null;
  /** 還要幾年；只有 status 是 ok 時有值 */
  years: number | null;
  /** FIRE 目標金額 ＝ 年支出 ÷ 提領率 */
  target: Prisma.Decimal;
  /** 模擬過的每一年的年底資產（不進位，保留完整精度）；沒有模擬時是空陣列 */
  yearly: Prisma.Decimal[];
}

export function calculateFireAge(input: FireAgeInput): FireAgeResult {
  const target = input.annualSpending.div(WITHDRAWAL_RATE);
  const done = (
    status: FireAgeResultStatus,
    yearly: Prisma.Decimal[] = [],
    years: number | null = null,
  ): FireAgeResult => ({
    status,
    age: years === null || input.age === null ? null : input.age + years,
    years,
    target,
    yearly,
  });

  if (input.currentAssets.gte(target)) return done('achieved');
  if (input.age === null) return done('need_birth_year');
  if (input.annualSaving === null) return done('need_saving');

  const growth = REAL_RETURN_RATE.plus(1);
  const yearly: Prisma.Decimal[] = [];
  let assets = input.currentAssets;
  for (let years = 1; input.age + years <= MAX_AGE; years++) {
    const next = assets.times(growth).plus(input.annualSaving);
    yearly.push(next);
    if (next.gte(target)) return done('ok', yearly, years);
    // 儲蓄 ≤ 0 而且報酬補不回來：資產不再成長，永遠達不到
    if (input.annualSaving.lte(0) && next.lte(assets)) {
      return done('unreachable', yearly);
    }
    assets = next;
  }
  return done('over_100', yearly);
}
