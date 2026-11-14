import { PartialType } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { CreateBillDto } from './create-bill.dto.js';

/**
 * PATCH：沒傳的欄位保持原值。skipNullProperties: false 讓不可為空的欄位傳 null 時回 400；
 * 可為空的 note 在這裡另外加 @IsOptional()，傳 null 代表清空。
 */
export class UpdateBillDto extends PartialType(CreateBillDto, {
  skipNullProperties: false,
}) {
  @IsOptional()
  note?: string | null;
}
