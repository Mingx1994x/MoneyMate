import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { IsMoney } from '../../../common/validators.js';

/**
 * PATCH /goal：沒傳的欄位保持原值。
 * monthlySpending 不可為 null；birthYear、estMonthlySaving 傳 null 代表清空。
 */
export class UpdateGoalDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1000,
    maximum: 333000,
    description: '每月花費，整數 1,000–333,000；目標金額自動重算為 × 300',
    example: 40000,
  })
  // 可以不帶，但不可為 null（@IsOptional() 會放過 null）
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1000)
  @Max(333000)
  monthlySpending?: number;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1900,
    description:
      '出生年，1900 到台北的今年（今年的上限由 service 檢查，超過回 VALIDATION_FAILED，field: birthYear）；null 代表清空',
    example: 1990,
  })
  @IsOptional()
  @IsInt()
  @Min(1900)
  // 日期範圍的上限（date-only.ts）；「不晚於今年」要用 ClockService，在 service 檢查
  @Max(2999)
  birthYear?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      '自估的每月儲蓄，金額字串，可以是 0 或負數（入不敷出）；null 代表清空',
    example: '15000.00',
  })
  @IsOptional()
  @IsMoney({ sign: 'any' })
  estMonthlySaving?: string | null;
}
