import { PartialType } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto.js';

/**
 * PATCH：沒傳的欄位保持原值。skipNullProperties: false 讓不可為空的欄位傳 null 時回 400；
 * categoryId、toAccountId、note 可為 null（清空）。改交易類型時，分類與轉入帳戶要一起改成符合新類型。
 */
export class UpdateTransactionDto extends PartialType(CreateTransactionDto, {
  skipNullProperties: false,
}) {
  @IsOptional()
  categoryId?: string | null;

  @IsOptional()
  toAccountId?: string | null;

  @IsOptional()
  note?: string | null;
}
