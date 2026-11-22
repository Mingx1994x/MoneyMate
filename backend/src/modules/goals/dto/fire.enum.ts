/**
 * 財富自由年齡的狀態（PRD 15.7）。ok 時 fireAge 有值，其他狀態 fireAge 是 null，前端依狀態顯示一句提示。
 * 寫法和 Prisma 產生的 enum 相同，Swagger 用 enumName: 'FireAgeStatus'。
 */
export const FireAgeStatus = {
  /** 算得出年齡 */
  ok: 'ok',
  /** 現在資產已經 ≥ FIRE 目標 */
  achieved: 'achieved',
  /** 沒有出生年 */
  need_birth_year: 'need_birth_year',
  /** 記帳不滿 3 個完整月，而且沒有自估的每月儲蓄 */
  need_saving: 'need_saving',
  /** 年儲蓄 ≤ 0，資產報酬也不夠 */
  unreachable: 'unreachable',
  /** 超過 100 歲才達成 */
  over_100: 'over_100',
} as const;

export type FireAgeStatus = (typeof FireAgeStatus)[keyof typeof FireAgeStatus];

/** 年儲蓄的來源：actual＝最近完整月的記帳平均，estimate＝goals.est_monthly_saving */
export const SavingSource = {
  actual: 'actual',
  estimate: 'estimate',
} as const;

export type SavingSource = (typeof SavingSource)[keyof typeof SavingSource];

/**
 * 推算達成日的狀態（PRD 15.6）。ok 時 monthsLeft、finishMonth 有值，其他狀態都是 null，前端依狀態顯示一句提示。
 */
export const FinishEstimateStatus = {
  /** 算得出還要幾個月 */
  ok: 'ok',
  /** 目前金額已經 ≥ 目標金額 */
  achieved: 'achieved',
  /** 記帳不滿 3 個完整月，而且沒有自估的每月儲蓄 →「資料不足，請填每月收支自估」 */
  need_saving: 'need_saving',
  /** 每月儲蓄 ≤ 0 →「以目前收支無法達成」 */
  unreachable: 'unreachable',
  /** 超過 600 個月 →「以目前速度超過 50 年」 */
  over_50_years: 'over_50_years',
} as const;

export type FinishEstimateStatus =
  (typeof FinishEstimateStatus)[keyof typeof FinishEstimateStatus];

/**
 * 緊急預備金夠幾個月的狀態（D-A-006）。ok 時 months 有值，其他狀態 months 是 null，前端依狀態顯示一句提示。
 */
export const EmergencyFundStatus = {
  /** 算得出可撐幾個月 */
  ok: 'ok',
  /** 最近 6 個完整月裡有記帳的月不滿 3 個 →「記帳滿 3 個月後就能算」 */
  need_data: 'need_data',
  /** 平均每月支出是 0（只記了收入）→ 無法計算 */
  no_expense: 'no_expense',
} as const;

export type EmergencyFundStatus =
  (typeof EmergencyFundStatus)[keyof typeof EmergencyFundStatus];
