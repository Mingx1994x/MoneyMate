import { ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, ValidateIf } from 'class-validator';
import { CreateAccountDto } from './create-account.dto.js';

/**
 * PATCH：沒傳的欄位保持原值。accountType、deductFromEstimate 不能改。
 * skipNullProperties: false 讓不可為空的欄位傳 null 時回 400；note 可為 null（清空）。
 */
export class UpdateAccountDto extends PartialType(
  PickType(CreateAccountDto, ['name', 'openingBalance', 'note'] as const),
  { skipNullProperties: false },
) {
  @IsOptional()
  note?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'false = 停用（目前餘額必須為 0，而且沒有未來日期的交易）；true = 重新啟用',
    example: false,
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
