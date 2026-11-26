import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn } from 'class-validator';
import {
  DASHBOARD_BLOCK_VALUES,
  DashboardBlock,
} from './dashboard-block.enum.js';

/** 重複的代碼會去重，所以不能用「代碼都認得而且不重複」推出長度上限；20 是寬鬆的上限，只擋超大的陣列 */
export const MAX_HIDDEN_BLOCKS_INPUT = 20;

/** PUT /dashboard/layout：整份取代 */
export class UpdateDashboardLayoutDto {
  @ApiProperty({
    enum: DashboardBlock,
    enumName: 'DashboardBlock',
    isArray: true,
    maxItems: MAX_HIDDEN_BLOCKS_INPUT,
    description:
      '要隱藏的區塊代碼，整份取代；[] 代表全部顯示。順序不影響結果、重複的代碼會去重。報表區塊（monthly-summary、net-worth、upcoming-bills、loans、trend）全部隱藏時回 DASHBOARD_REPORT_REQUIRED',
    example: ['loans', 'trend'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_HIDDEN_BLOCKS_INPUT)
  @IsIn(DASHBOARD_BLOCK_VALUES, { each: true })
  hiddenBlocks!: DashboardBlock[];
}

export class DashboardLayoutResponseDto {
  @ApiProperty({
    enum: DashboardBlock,
    enumName: 'DashboardBlock',
    isArray: true,
    description:
      '隱藏的區塊代碼，已去重、依固定順序排列（不代表畫面上的順序）；[] 代表全部顯示',
    example: ['loans', 'trend'],
  })
  hiddenBlocks!: DashboardBlock[];
}
