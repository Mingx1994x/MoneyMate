/**
 * Dashboard 可以分階段交付的區塊。還沒完成的區塊回 null，並列在 unavailable，前端顯示「準備中」。
 * 寫法和 Prisma 產生的 enum 相同，Swagger 用 enumName: 'DashboardSection'。
 */
export const DashboardSection = {
  bills: 'bills',
  loans: 'loans',
  goal: 'goal',
} as const;

export type DashboardSection =
  (typeof DashboardSection)[keyof typeof DashboardSection];

/** 一句下一步的類型（PRD 15.5，依序判斷，第一個符合的就顯示） */
export const NextStepType = {
  overdue_bills: 'overdue_bills',
  funding_gap: 'funding_gap',
  next_milestone: 'next_milestone',
  goal_achieved: 'goal_achieved',
  onboarding: 'onboarding',
} as const;

export type NextStepType = (typeof NextStepType)[keyof typeof NextStepType];
