import {
  Controller,
  Get,
  NotImplementedException,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiAuth,
  ApiErrors,
  ApiNotImplemented,
} from '../../common/swagger/api-decorators.js';
import { DashboardSummaryQueryDto } from './dto/dashboard-query.dto.js';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary.dto.js';

/**
 * dashboard 空殼（C）：照 loans 範例寫。
 * - handler 只丟 NotImplementedException（501），不寫 async。
 * - 沒用到的參數加 _ 前綴，實作時拿掉；@CurrentUser() 由 AUTH-1 提供，實作時再加。
 * - 實作 PR 要拿掉 @ApiNotImplemented()。
 * GET /dashboard/trend 是 P1，P0 不建。
 */
@ApiTags('dashboard')
@ApiAuth()
@Controller('dashboard')
export class DashboardController {
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
  @ApiNotImplemented()
  summary(
    @Query() _query: DashboardSummaryQueryDto,
  ): DashboardSummaryResponseDto {
    throw new NotImplementedException();
  }
}
