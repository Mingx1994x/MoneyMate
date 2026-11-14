import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { IsMonth } from '../../../common/validators.js';

export class DashboardSummaryQueryDto {
  @ApiPropertyOptional({
    description:
      '月份 YYYY-MM，只影響本月收支區塊（income、expense、savingsRate）；不帶時是台北本月',
    example: '2026-10',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsMonth()
  month?: string;
}
