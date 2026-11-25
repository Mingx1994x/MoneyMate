import { ApiProperty } from '@nestjs/swagger';
import {
  FinishEstimateStatus,
  FireAgeStatus,
  SavingSource,
} from './fire.enum.js';

/** 里程碑（PRD 15.4）：10 萬、100 萬、目標 ÷ 2，刪掉 ≥ 目標的站，最後加上終點 */
export class MilestoneDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: '第幾站，從 1 開始',
    example: 1,
  })
  index!: number;

  @ApiProperty({ description: '這一站的金額，金額字串', example: '100000.00' })
  amount!: string;

  @ApiProperty({ example: '緊急預備金' })
  label!: string;

  @ApiProperty({ description: '目前金額 ≥ 這一站', example: true })
  reached!: boolean;
}

export class NextMilestoneDto extends MilestoneDto {
  @ApiProperty({
    description: '再存多少就到這一站，金額字串，> 0',
    example: '200000.00',
  })
  remaining!: string;
}

/** 財富自由年齡用了哪些數字，前端顯示在小字（PRD 15.7） */
export class FireAssumptionsDto {
  @ApiProperty({
    description: '年支出 ＝ 每月花費 × 12，金額字串',
    example: '480000.00',
  })
  annualSpending!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '年儲蓄，金額字串；沒有實際記帳也沒有自估值時是 null',
    example: '180000.00',
  })
  annualSaving!: string | null;

  @ApiProperty({
    enum: SavingSource,
    enumName: 'SavingSource',
    nullable: true,
    description: '年儲蓄的來源；annualSaving 是 null 時也是 null',
    example: 'estimate',
  })
  savingSource!: SavingSource | null;

  @ApiProperty({
    description: '現在資產 ＝ 帳戶合計（未扣除貸款），金額字串',
    example: '800000.00',
  })
  currentAssets!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: '年齡 ＝ 台北的今年 − 出生年；沒有出生年時是 null',
    example: 36,
  })
  age!: number | null;
}

/** 推算達成日（PRD 15.6、D-A-004），前端固定標示「依目前儲蓄速度估算，未計入投資報酬」 */
export class FinishEstimateDto {
  @ApiProperty({
    enum: FinishEstimateStatus,
    enumName: 'FinishEstimateStatus',
    description:
      'ok：算得出來；achieved：已達成；need_saving：資料不足，請填每月收支自估；unreachable：以目前收支無法達成；over_50_years：以目前速度超過 50 年',
    example: 'ok',
  })
  status!: FinishEstimateStatus;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 600,
    description:
      '還要幾個月 ＝（目標 − 目前）÷ 每月儲蓄，無條件進位；status 不是 ok 時是 null',
    example: 300,
  })
  monthsLeft!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '預計達成的月份（YYYY-MM）＝ 台北的本月 ＋ monthsLeft；status 不是 ok 時是 null',
    example: '2051-11',
  })
  finishMonth!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '推算用的每月儲蓄，金額字串，來源同 fireAssumptions.savingSource；沒有實際記帳也沒有自估值時是 null',
    example: '15000.00',
  })
  monthlySaving!: string | null;
}

/** 目標進度＋財富自由年齡（GET /goal/progress、POST /onboarding 的回應） */
export class GoalProgressDto {
  @ApiProperty({ description: '目標金額，金額字串', example: '12000000.00' })
  targetAmount!: string;

  @ApiProperty({
    description: '目前金額 ＝ 帳戶合計（PRD 15.1），可為負，金額字串',
    example: '800000.00',
  })
  currentAmount!: string;

  @ApiProperty({
    description: '還差多少 ＝ max(0, 目標 − 目前)，金額字串',
    example: '11200000.00',
  })
  remaining!: string;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: '達成百分比，小數一位；≤ 0 時 0，≥ 目標時 100',
    example: 6.7,
  })
  percent!: number;

  @ApiProperty({ description: '目前金額 ≥ 目標金額', example: false })
  achieved!: boolean;

  @ApiProperty({
    type: [MilestoneDto],
    description: '由小到大，最後一站是目標金額',
  })
  milestones!: MilestoneDto[];

  @ApiProperty({
    type: NextMilestoneDto,
    nullable: true,
    description: '下一個還沒到的站；全部達成時是 null',
  })
  nextMilestone!: NextMilestoneDto | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: '財富自由年齡；fireAgeStatus 不是 ok 時是 null',
    example: 51,
  })
  fireAge!: number | null;

  @ApiProperty({
    enum: FireAgeStatus,
    enumName: 'FireAgeStatus',
    example: 'ok',
  })
  fireAgeStatus!: FireAgeStatus;

  @ApiProperty({ type: FinishEstimateDto })
  finishEstimate!: FinishEstimateDto;

  @ApiProperty({ type: FireAssumptionsDto })
  fireAssumptions!: FireAssumptionsDto;

  @ApiProperty({
    description:
      'active 貸款的未償餘額合計，金額字串；> 0 時前端顯示「目前資產未扣除貸款 X 元」',
    example: '0.00',
  })
  activeLoanTotal!: string;
}
