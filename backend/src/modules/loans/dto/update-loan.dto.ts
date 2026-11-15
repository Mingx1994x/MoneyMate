import { PartialType } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { CreateLoanDto } from './create-loan.dto.js';

/**
 * PATCH：沒傳的欄位保持原值。skipNullProperties: false 讓不可為空的欄位傳 null 時回 400；
 * 可為空的欄位（interestRate、note）在這裡另外加 @IsOptional()，傳 null 代表清空。
 */
export class UpdateLoanDto extends PartialType(CreateLoanDto, {
  skipNullProperties: false,
}) {
  @IsOptional()
  interestRate?: number | null;

  @IsOptional()
  note?: string | null;
}
