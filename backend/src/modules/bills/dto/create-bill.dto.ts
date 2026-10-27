import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, ValidateIf } from 'class-validator';
import { IsId } from '../../../common/id.js';
import {
  EmptyToNull,
  IsDateOnly,
  IsMoney,
  IsName,
  IsNote,
  Trim,
} from '../../../common/validators.js';
import { Recurrence } from '../../../prisma/index.js';

/** dueDay、dueMonth、seriesId、status、paidAmount、paidDate 由後端決定，不在請求中 */
export class CreateBillDto {
  @ApiProperty({
    description: '帳單名稱，去除前後空白後 1–30 字',
    minLength: 1,
    maxLength: 30,
    example: '房租',
  })
  @Trim()
  @IsName()
  name!: string;

  @ApiProperty({
    description: '預定金額，金額字串，> 0；下一期沿用這個金額',
    example: '15000.00',
  })
  @IsMoney({ sign: 'positive' })
  amount!: string;

  @ApiProperty({
    format: 'uuid',
    description: '支出分類（收入分類回 CATEGORY_TYPE_MISMATCH）',
    example: '0b8d3c7e-2f4a-4e6b-9c1d-5a7f8e9b0c21',
  })
  @IsId('CATEGORY_NOT_FOUND')
  categoryId!: string;

  @ApiProperty({
    format: 'uuid',
    description: '預設扣款帳戶，必須是啟用中的帳戶',
    example: '9e2f6a14-3b7c-4d8e-a5f1-6c0b2d4e8a73',
  })
  @IsId('ACCOUNT_NOT_FOUND')
  accountId!: string;

  @ApiProperty({
    format: 'date',
    description:
      '到期日。可以是過去的日期（建立後就是逾期）；日期是 29–31 時，之後遇到短月用當月最後一天',
    example: '2026-11-01',
  })
  @IsDateOnly()
  dueDate!: string;

  @ApiPropertyOptional({
    enum: Recurrence,
    enumName: 'Recurrence',
    default: Recurrence.none,
    example: 'monthly',
  })
  // 可以不帶，但不可為 null（@IsOptional() 會放過 null）
  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(Recurrence)
  recurrence?: Recurrence;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    description: '備註，最多 200 字；空字串存成 null',
    example: '每月 1 日',
  })
  @IsOptional()
  @EmptyToNull()
  @IsNote()
  note?: string | null;
}
