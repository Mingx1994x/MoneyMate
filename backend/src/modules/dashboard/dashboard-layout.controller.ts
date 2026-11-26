import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-decorators.js';
import { CurrentUser, type AuthUser } from '../auth/index.js';
import { DashboardLayoutService } from './dashboard-layout.service.js';
import {
  DashboardLayoutResponseDto,
  UpdateDashboardLayoutDto,
} from './dto/dashboard-layout.dto.js';

const LAYOUT_RULES = [
  '可以隱藏的區塊：第一屏 today-bills、cash-gap；報表 monthly-summary、net-worth、upcoming-bills、loans、trend。一句下一步、快速記帳固定顯示，沒有代碼（D-A-008）。',
  '只存「隱藏」的清單：之後新增的區塊不在清單裡，預設就會顯示。隱藏只影響畫面，/dashboard/summary 照常計算所有區塊（nextStep 也照常判斷逾期帳單）。',
  'hiddenBlocks 一律去重、依上面列的固定順序回傳，不代表畫面上的順序。',
  'token 對應的使用者不存在時（例如資料庫被重設）回 401 AUTH_UNAUTHENTICATED，和 /auth/me 相同。',
];

/**
 * dashboard layout（E，D-A-008）：Dashboard 自選顯示區塊。
 * 和 C 的 DashboardController 同一個路徑前綴，另外開 controller，不動 /dashboard/summary。
 */
@ApiTags('dashboard')
@ApiAuth()
@Controller('dashboard')
export class DashboardLayoutController {
  constructor(private readonly layout: DashboardLayoutService) {}

  @Get('layout')
  @ApiOperation({
    summary: '取得 Dashboard 隱藏的區塊',
    description: [
      ...LAYOUT_RULES,
      '還沒設定過時回 []（全部顯示）。資料庫裡已經不存在的舊代碼會被過濾掉。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: DashboardLayoutResponseDto })
  getLayout(
    @CurrentUser() user: AuthUser,
  ): Promise<DashboardLayoutResponseDto> {
    return this.layout.getLayout(user.id);
  }

  @Put('layout')
  @ApiOperation({
    summary: '更新 Dashboard 隱藏的區塊（整份取代）',
    description: [
      ...LAYOUT_RULES,
      '送整份清單、整份取代，[] 代表全部顯示。順序不影響結果，重複的代碼會去重；回傳整理後存進資料庫的清單。',
      '不認得的代碼、不是陣列、超過 20 個元素回 VALIDATION_FAILED（field: hiddenBlocks）。去重後 5 個報表區塊全部隱藏時回 DASHBOARD_REPORT_REQUIRED（field: hiddenBlocks），設定不變。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: DashboardLayoutResponseDto })
  @ApiErrors('VALIDATION_FAILED', 'DASHBOARD_REPORT_REQUIRED')
  updateLayout(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateDashboardLayoutDto,
  ): Promise<DashboardLayoutResponseDto> {
    return this.layout.updateLayout(user.id, dto.hiddenBlocks);
  }
}
