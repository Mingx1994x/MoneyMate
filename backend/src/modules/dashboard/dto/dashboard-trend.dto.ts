import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { ToNumber } from '../../../common/validators.js';

/** 趨勢圖最多看幾個月（一年） */
export const TREND_MAX_MONTHS = 12;
/** 不帶 months 時看幾個月（PRD 第十三節、US-14） */
export const TREND_DEFAULT_MONTHS = 6;

export class DashboardTrendQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    default: TREND_DEFAULT_MONTHS,
    minimum: 1,
    maximum: TREND_MAX_MONTHS,
    description: '最近幾個完整月（不含台北本月）',
  })
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(TREND_MAX_MONTHS)
  months: number = TREND_DEFAULT_MONTHS;
}

export class DashboardTrendMonthDto {
  @ApiProperty({ description: '月份 YYYY-MM', example: '2026-10' })
  month!: string;

  @ApiProperty({
    description: '該月收入合計，金額字串；沒有交易是 "0.00"',
    example: '52000.00',
  })
  incomeTotal!: string;

  @ApiProperty({
    description: '該月支出合計，金額字串；不含轉帳、繳卡費',
    example: '31850.00',
  })
  expenseTotal!: string;
}

/** 不分頁的列表也包一層 items（README「回應格式」） */
export class DashboardTrendResponseDto {
  @ApiProperty({
    type: [DashboardTrendMonthDto],
    description: '由舊到新，固定 months 筆',
  })
  items!: DashboardTrendMonthDto[];
}
