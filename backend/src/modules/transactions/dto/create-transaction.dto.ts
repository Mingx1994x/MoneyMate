import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, ValidateIf } from 'class-validator';
import { IsId } from '../../../common/id.js';
import {
  EmptyToNull,
  IsDateOnly,
  IsMoney,
  IsNote,
} from '../../../common/validators.js';
import { TransactionType } from '../../../prisma/index.js';

/**
 * 收入／支出：要有 categoryId、不可帶 toAccountId；轉帳：要有 toAccountId、不可帶 categoryId。
 * 跨欄位的規則在 service 檢查（TRANSACTION_FIELDS_MISMATCH、TRANSFER_SAME_ACCOUNT、CATEGORY_TYPE_MISMATCH）。
 */
export class CreateTransactionDto {
  @ApiProperty({
    enum: TransactionType,
    enumName: 'TransactionType',
    description: '繳卡費＝銀行 → 信用卡的 transfer，不是 expense',
    example: 'expense',
  })
  @IsEnum(TransactionType)
  transactionType!: TransactionType;

  @ApiProperty({ description: '金額字串，> 0', example: '120.00' })
  @IsMoney({ sign: 'positive' })
  amount!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      '收入／支出的帳戶；轉帳的轉出帳戶。必須是登入者啟用中的帳戶。快速記帳時由前端帶入上次使用的帳戶',
    example: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  })
  @IsId('ACCOUNT_NOT_FOUND')
  accountId!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      '分類。收入／支出必填，類型要和 transactionType 相同；轉帳不可帶（或傳 null）',
    example: '7b1d6e2a-3c4f-4a8e-9d10-5e6f7a8b9c0d',
  })
  @IsOptional()
  @IsId('CATEGORY_NOT_FOUND')
  categoryId?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      '轉入帳戶。轉帳必填，不可與 accountId 相同、必須是登入者啟用中的帳戶；收入／支出不可帶（或傳 null）',
    example: '2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182',
  })
  @IsOptional()
  @IsId('ACCOUNT_NOT_FOUND')
  toAccountId?: string | null;

  @ApiPropertyOptional({
    format: 'date',
    description:
      '交易日期；不帶時是台北今天。可以是未來日期（預先記帳），但日期 > 台北今天的交易不計入目前餘額與本月收支',
    example: '2026-10-25',
  })
  // 可以不帶，但不可為 null
  @ValidateIf((_, v) => v !== undefined)
  @IsDateOnly()
  transactionDate?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    description: '備註，最多 200 字；空字串存成 null',
    example: '午餐',
  })
  @IsOptional()
  @EmptyToNull()
  @IsNote()
  note?: string | null;
}
