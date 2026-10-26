import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  EmptyToNull,
  IsDateOnly,
  IsMoney,
  IsName,
  IsNote,
  IsRate,
  Trim,
} from '../../../common/validators.js';
import { LoanStatus } from '../../../prisma/index.js';
import { LOAN_TYPE_VALUES, LoanType } from './loan-type.enum.js';

export class CreateLoanDto {
  @ApiProperty({
    description: '貸款名稱，去除前後空白後 1–30 字',
    minLength: 1,
    maxLength: 30,
    example: '房貸',
  })
  @Trim()
  @IsName()
  name!: string;

  @ApiProperty({ enum: LoanType, enumName: 'LoanType', example: 'mortgage' })
  @IsIn(LOAN_TYPE_VALUES)
  loanType!: LoanType;

  @ApiProperty({
    description: '未償餘額，金額字串，≥ 0（0 代表已還完）',
    example: '1000000.00',
  })
  @IsMoney({ sign: 'nonNegative' })
  outstandingBalance!: string;

  @ApiPropertyOptional({
    description:
      '每月還款，金額字串，> 0。沒帶時後端依年利率自動計算；前端表單一律帶（用試算結果預填）',
    example: '17969.00',
  })
  // 可以不帶，但不可為 null（@IsOptional() 會放過 null）
  @ValidateIf((_, v) => v !== undefined)
  @IsMoney({ sign: 'positive' })
  monthlyPayment?: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 31,
    description: '每月繳款日；29–31 遇短月用當月最後一天',
    example: 5,
  })
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDay!: number;

  @ApiProperty({
    format: 'date',
    description:
      '結清日。早於台北今天時 status 必須是 closed；不可晚於台北今天加 50 年',
    example: '2031-09-30',
  })
  @IsDateOnly()
  endDate!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 100,
    description: '年利率 %，例如 3 代表 3%；最多 3 位小數。不知道可以不填',
    example: 3,
  })
  @IsOptional()
  @IsRate()
  interestRate?: number | null;

  @ApiPropertyOptional({
    enum: LoanStatus,
    enumName: 'LoanStatus',
    default: LoanStatus.active,
    example: 'active',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(LoanStatus)
  status?: LoanStatus;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    description: '備註，最多 200 字；空字串存成 null',
    example: '每月 5 日自動扣款',
  })
  @IsOptional()
  @EmptyToNull()
  @IsNote()
  note?: string | null;
}
