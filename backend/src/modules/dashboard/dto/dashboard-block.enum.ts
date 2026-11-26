/**
 * Dashboard 可以隱藏的區塊（D-A-008，代碼由 B 在 PR #107 提出）。
 * 一句下一步、快速記帳不能隱藏，所以沒有代碼。代碼存在 users.dashboard_hidden_blocks，上線後不改名。
 * 寫法和 Prisma 產生的 enum 相同，Swagger 用 enumName: 'DashboardBlock'。宣告順序就是回應的固定順序。
 */
export const DashboardBlock = {
  // 第一屏
  'today-bills': 'today-bills',
  'cash-gap': 'cash-gap',
  // 報表
  'monthly-summary': 'monthly-summary',
  'net-worth': 'net-worth',
  'upcoming-bills': 'upcoming-bills',
  loans: 'loans',
  trend: 'trend',
} as const;

export type DashboardBlock =
  (typeof DashboardBlock)[keyof typeof DashboardBlock];

export const DASHBOARD_BLOCK_VALUES: readonly DashboardBlock[] =
  Object.values(DashboardBlock);

/** 報表的區塊：至少要留一個顯示（D-A-008） */
export const DASHBOARD_REPORT_BLOCKS: readonly DashboardBlock[] = [
  DashboardBlock['monthly-summary'],
  DashboardBlock['net-worth'],
  DashboardBlock['upcoming-bills'],
  DashboardBlock.loans,
  DashboardBlock.trend,
];
