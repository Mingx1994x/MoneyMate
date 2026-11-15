import { ApiProperty } from '@nestjs/swagger';
import { DashboardSection, NextStepType } from './dashboard-section.enum.js';

export class DashboardBillBriefDto {
  @ApiProperty({
    format: 'uuid',
    example: '4d3c2b1a-0f9e-4d8c-b7a6-958473625140',
  })
  id!: string;

  @ApiProperty({ example: '房租' })
  name!: string;

  @ApiProperty({ description: '預定金額，金額字串', example: '18000.00' })
  amount!: string;

  @ApiProperty({ format: 'date', example: '2026-10-28' })
  dueDate!: string;

  @ApiProperty({
    type: 'integer',
    description: '到期日 − 台北今天的天數；逾期是負數、今天到期是 0',
    example: 3,
  })
  daysUntilDue!: number;
}

export class DashboardLoanPaymentDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10',
  })
  loanId!: string;

  @ApiProperty({ example: '房貸' })
  name!: string;

  @ApiProperty({
    format: 'date',
    description: '還款日（paymentDay 遇短月用當月最後一天）',
    example: '2026-11-05',
  })
  date!: string;

  @ApiProperty({ description: '每月還款，金額字串', example: '17969.00' })
  monthlyPayment!: string;
}

export class DashboardLoansDto {
  @ApiProperty({
    description: 'active 貸款的未償餘額合計',
    example: '1000000.00',
  })
  outstandingTotal!: string;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  activeCount!: number;

  @ApiProperty({
    type: [DashboardLoanPaymentDto],
    description: '台北今天到今天＋14 天（含頭尾）的還款日，和帳單同一個範圍',
  })
  upcomingPayments!: DashboardLoanPaymentDto[];
}

export class DashboardMilestoneDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: '第幾站（1 起算）',
    example: 2,
  })
  index!: number;

  @ApiProperty({ description: '這一站的金額', example: '1000000.00' })
  amount!: string;

  @ApiProperty({ example: '第一桶金' })
  label!: string;

  @ApiProperty({ description: '還差多少到這一站', example: '760000.00' })
  remaining!: string;
}

/** 目標進度的摘要；完整內容（里程碑列表、財富自由年齡）用 GET /goal/progress（D） */
export class DashboardGoalDto {
  @ApiProperty({ example: '12000000.00' })
  targetAmount!: string;

  @ApiProperty({
    description: '目前金額＝帳戶合計（PRD 15.3）',
    example: '240000.00',
  })
  currentAmount!: string;

  @ApiProperty({
    type: Number,
    description: '達成百分比，小數一位；≤ 0 是 0，達成是 100',
    example: 2,
  })
  percent!: number;

  @ApiProperty({ example: false })
  achieved!: boolean;

  @ApiProperty({
    type: DashboardMilestoneDto,
    nullable: true,
    description: '下一站；已達成目標時是 null',
  })
  nextMilestone!: DashboardMilestoneDto | null;
}

export class DashboardNextStepDto {
  @ApiProperty({
    enum: NextStepType,
    enumName: 'NextStepType',
    description:
      '依序判斷（PRD 15.5）：overdue_bills → funding_gap → next_milestone（已達成時 goal_achieved）→ onboarding',
    example: 'next_milestone',
  })
  type!: NextStepType;

  @ApiProperty({
    description: '畫面直接顯示的一句話',
    example: '再存 760,000 元就到第 2 站',
  })
  message!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '句子裡的大數字（缺口、還差多少）；overdue_bills、goal_achieved、onboarding 是 null',
    example: '760000.00',
  })
  amount!: string | null;
}

/**
 * GET /dashboard/summary 的回應（PRD 15、17）。數字一律由 FinanceCalcService 等共用 service 計算，
 * 任一 service 出錯整支回 500，不回傳部分數字（PRD 18）。
 */
export class DashboardSummaryResponseDto {
  @ApiProperty({
    format: 'date',
    description: '計算用的台北今天',
    example: '2026-10-25',
  })
  today!: string;

  @ApiProperty({
    description: '本月收支區塊的月份 YYYY-MM',
    example: '2026-10',
  })
  month!: string;

  @ApiProperty({
    description: '該月收入合計（不含轉帳、不含未來日期）',
    example: '50000.00',
  })
  income!: string;

  @ApiProperty({
    description: '該月支出合計（不含轉帳、不含未來日期）',
    example: '30000.00',
  })
  expense!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '儲蓄率 %，小數一位，可為負；收入為 0 時是 null（畫面顯示「—」）',
    example: 40,
  })
  savingsRate!: number | null;

  @ApiProperty({
    description:
      '帳戶合計：啟用帳戶目前餘額加總（含信用卡負值、投資、估計帳戶）',
    example: '240000.00',
  })
  accountsTotal!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '淨資產：所有帳戶目前餘額 − active 貸款未償餘額。loans 區塊未完成時是 null（不扣貸款的數字看起來正常但會偏高，所以不回傳），前端顯示「準備中」',
    example: '-760000.00',
  })
  netWorth!: string | null;

  @ApiProperty({
    description: '可用現金：啟用中 cash＋bank 帳戶（不含估計帳戶）',
    example: '260000.00',
  })
  availableCash!: string;

  @ApiProperty({
    description:
      '有沒有啟用中的現金／銀行帳戶（不含估計帳戶）；false 時不計算資金缺口',
    example: true,
  })
  hasCashAccounts!: boolean;

  @ApiProperty({
    type: [DashboardBillBriefDto],
    nullable: true,
    description:
      '逾期未繳帳單，依到期日由舊到新，最多 5 筆；bills 區塊未完成時是 null',
  })
  billsOverdue!: DashboardBillBriefDto[] | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 0,
    description:
      '逾期未繳帳單的總張數（不受 5 筆上限影響）；bills 區塊未完成時是 null',
    example: 0,
  })
  billsOverdueCount!: number | null;

  @ApiProperty({
    type: [DashboardBillBriefDto],
    nullable: true,
    description:
      '台北今天到今天＋14 天（含頭尾）到期的待繳帳單，依到期日排序，最多 5 筆；bills 區塊未完成時是 null',
  })
  billsDueSoon!: DashboardBillBriefDto[] | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '14 天資金缺口：14 天內待繳帳單合計 − 可用現金，> 0 時才有值；沒有缺口、沒有現金／銀行帳戶，或 bills 區塊未完成時是 null（PRD 15.5）',
    example: '15000.00',
  })
  fundingGap!: string | null;

  @ApiProperty({
    type: DashboardLoansDto,
    nullable: true,
    description: '貸款摘要；loans 區塊未完成時是 null',
  })
  loans!: DashboardLoansDto | null;

  @ApiProperty({
    type: DashboardGoalDto,
    nullable: true,
    description: '目標進度摘要；還沒完成問卷，或 goal 區塊未完成時是 null',
  })
  goal!: DashboardGoalDto | null;

  @ApiProperty({
    type: DashboardNextStepDto,
    nullable: true,
    description:
      '一句下一步。判斷需要 bills 與 goal 區塊；任一個未完成時是 null（資料不完整時不給可能錯誤的建議），前端顯示「準備中」',
  })
  nextStep!: DashboardNextStepDto | null;

  @ApiProperty({
    enum: DashboardSection,
    enumName: 'DashboardSection',
    isArray: true,
    description:
      '還沒完成的區塊，前端顯示「準備中」；全部完成時是 []。bills 未完成 → 帳單欄位、fundingGap、nextStep 是 null；loans 未完成 → loans、netWorth 是 null；goal 未完成 → goal、nextStep 是 null',
    example: ['loans'],
  })
  unavailable!: DashboardSection[];
}
