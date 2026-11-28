import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClockService } from '../../clock/clock.service.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-decorators.js';
import { CurrentUser, type AuthUser } from '../auth/index.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardSummaryQueryDto } from './dto/dashboard-query.dto.js';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary.dto.js';
import {
  DashboardTrendQueryDto,
  DashboardTrendResponseDto,
} from './dto/dashboard-trend.dto.js';

/**
 * dashboard（C）：本月收支、儲蓄率、帳戶合計、可用現金（C），帳單、貸款（E），目標（D）；未實作的區塊列進 unavailable。
 * 目標接上 D 的 getGoalProgress：還沒完成問卷時 goal 是 null、nextStep 是 onboarding。
 * GET /dashboard/trend（P1，D-A-005）：月收支趨勢圖用的最近 N 個完整月收支。
 */
@ApiTags('dashboard')
@ApiAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly clock: ClockService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Dashboard 全部區塊＋一句下一步',
    description: [
      '一支 API 回傳所有區塊（PRD 17）。「今天」一律用台北時間（ClockService）。month 只影響 income、expense、savingsRate，其他區塊都用台北今天。',
      'nextStep 依序判斷（PRD 15.5）：① 有逾期未繳帳單 → overdue_bills ② 有啟用的現金／銀行帳戶、14 天內有待繳帳單且缺口 > 0 → funding_gap ③ 有目標 → next_milestone（已達成時 goal_achieved）④ 沒有目標 → onboarding。永遠只有一句。',
      '還沒完成的區塊回 null 並列在 unavailable。依賴未完成區塊的數字也回 null，不回傳看起來正常但不正確的值：loans 未完成時 netWorth 是 null；bills 或 goal 未完成時 nextStep 是 null。任一 service 出錯整支回 500，不回傳部分數字。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: DashboardSummaryResponseDto })
  @ApiErrors('VALIDATION_FAILED')
  summary(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardSummaryQueryDto,
  ): Promise<DashboardSummaryResponseDto> {
    return this.dashboard.getSummary(user.id, this.clock.today(), query.month);
  }

  @Get('trend')
  @ApiOperation({
    summary: '月收支趨勢（最近 N 個完整月）',
    description: [
      '回傳最近 months 個完整月的收入、支出合計（D-A-005、US-14），不含台北本月，由舊到新排序。例：台北今天 2026-11-20、months=6 → 2026-05～2026-10。',
      '規則與 summary 的本月收支相同（PRD 15.2）：只加收入、支出，不含轉帳與繳卡費；停用帳戶的交易也算。沒有交易的月也會回傳，收支都是 "0.00"。',
      '回應包一層 { items: [...] }，和其他不分頁的列表相同。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: DashboardTrendResponseDto })
  @ApiErrors('VALIDATION_FAILED')
  trend(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardTrendQueryDto,
  ): Promise<DashboardTrendResponseDto> {
    return this.dashboard.getTrend(user.id, this.clock.today(), query.months);
  }
}
