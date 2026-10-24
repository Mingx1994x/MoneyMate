import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateOnly,
  IsMoney,
  IsRate,
  ToNumber,
} from '../../../common/validators.js';

export class LoanPaymentPreviewQueryDto {
  @ApiProperty({
    description: '未償餘額，金額字串，> 0',
    example: '1000000.00',
  })
  @IsMoney({ sign: 'positive' })
  outstandingBalance!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 100,
    description: '年利率 %，最多 3 位小數；空字串回 400，不會被當成 0%',
    example: 3,
  })
  @ToNumber()
  @IsRate()
  interestRate!: number;

  @ApiProperty({
    format: 'date',
    description:
      '結清日。早於本月時期數視為 1；晚於台北今天加 50 年回 400 VALIDATION_FAILED',
    example: '2031-09-30',
  })
  @IsDateOnly()
  endDate!: string;
}

/** 範例值是 2026/10 時，100 萬、3%、結清日 2031-09-30（60 期）的結果（PRD 15.8 的驗算案例） */
export class LoanPaymentPreviewResponseDto {
  @ApiProperty({ description: '建議每月還款，到元', example: '17969.00' })
  monthlyPayment!: string;

  @ApiProperty({ description: '預估總利息', example: '78120.00' })
  totalInterest!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: '剩餘期數：台北本月到結清日所在月份（含頭尾），至少 1',
    example: 60,
  })
  installments!: number;
}
