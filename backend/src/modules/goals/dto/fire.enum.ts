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
