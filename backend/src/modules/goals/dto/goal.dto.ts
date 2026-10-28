import { ApiProperty } from '@nestjs/swagger';

/** 目標設定（GET／PATCH /goal）。不放 userId */
export class GoalDto {
  @ApiProperty({ example: '財富自由' })
  name!: string;

  @ApiProperty({
    description: '財富自由後每月想花多少，金額字串（一定是整數元）',
    example: '40000.00',
  })
  monthlySpending!: string;

  @ApiProperty({
    description: '目標金額 ＝ 每月花費 × 300，金額字串，由後端計算',
    example: '12000000.00',
  })
  targetAmount!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: '出生年，算財富自由年齡用；沒填時是 null',
    example: 1990,
  })
  birthYear!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '自估的每月儲蓄，金額字串；只有記帳不滿 3 個完整月時才用到。沒填時是 null',
    example: '15000.00',
  })
  estMonthlySaving!: string | null;
}
