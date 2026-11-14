import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, ValidateIf } from 'class-validator';
import { IsId } from '../../../common/id.js';
import { PaginationQueryDto } from '../../../common/pagination.dto.js';
import { IsDateOnly } from '../../../common/validators.js';
import { TransactionType } from '../../../prisma/index.js';

/** 篩選條件都是選填，同時帶多個時取交集（AND）。 */
export class TransactionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    description: '交易日期起（含）',
    example: '2026-10-01',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsDateOnly()
  dateFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: '交易日期迄（含）；早於 dateFrom 時回 400 VALIDATION_FAILED',
    example: '2026-10-31',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsDateOnly()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: TransactionType,
    enumName: 'TransactionType',
    example: 'expense',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(TransactionType)
  transactionType?: TransactionType;

  @ApiPropertyOptional({
    format: 'uuid',
    description: '分類（轉帳沒有分類，所以帶這個條件時不會出現轉帳）',
    example: '7b1d6e2a-3c4f-4a8e-9d10-5e6f7a8b9c0d',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsId('CATEGORY_NOT_FOUND')
  categoryId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      '帳戶：accountId 或 toAccountId 是這個帳戶的交易都會列出（含停用帳戶）',
    example: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsId('ACCOUNT_NOT_FOUND')
  accountId?: string;
}
