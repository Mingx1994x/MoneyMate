import { ApiProperty } from '@nestjs/swagger';
import { LoanStatus } from '../../../prisma/index.js';
import { LoanType } from './loan-type.enum.js';

/** 貸款的回應。不放 userId；「餘額最後更新：X 天前」由前端用 balanceUpdatedAt 計算。 */
export class LoanResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10',
  })
  id!: string;

  @ApiProperty({ example: '房貸' })
  name!: string;

  @ApiProperty({ enum: LoanType, enumName: 'LoanType', example: 'mortgage' })
  loanType!: LoanType;

  @ApiProperty({ description: '未償餘額，金額字串', example: '1000000.00' })
  outstandingBalance!: string;

  @ApiProperty({ description: '每月還款，金額字串', example: '17969.00' })
  monthlyPayment!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 31, example: 5 })
  paymentDay!: number;

  @ApiProperty({ format: 'date', example: '2031-09-30' })
  endDate!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 100,
    description: '年利率 %，沒填時是 null',
    example: 3,
  })
  interestRate!: number | null;

  @ApiProperty({ enum: LoanStatus, enumName: 'LoanStatus', example: 'active' })
  status!: LoanStatus;

  @ApiProperty({
    format: 'date-time',
    description:
      '最後一次更新未償餘額的時間（請求有帶 outstandingBalance 就更新，即使數字相同）',
    example: '2026-10-24T02:30:00.000Z',
  })
  balanceUpdatedAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '每月 5 日自動扣款',
  })
  note!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-24T02:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-24T02:30:00.000Z' })
  updatedAt!: string;
}

/** 不分頁的列表也包一層 items */
export class LoanListResponseDto {
  @ApiProperty({ type: [LoanResponseDto] })
  items!: LoanResponseDto[];
}
