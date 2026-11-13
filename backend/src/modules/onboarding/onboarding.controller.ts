import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClockService } from '../../clock/clock.service.js';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-decorators.js';
import { CurrentUser, type AuthUser } from '../auth/index.js';
import { GoalProgressDto } from '../goals/dto/goal-progress.dto.js';
import { GoalsService } from '../goals/index.js';
import { CreateOnboardingDto } from './dto/create-onboarding.dto.js';
import { OnboardingService } from './onboarding.service.js';

/** ONB：送出問卷（PRD 第十二節）。 */
@ApiTags('onboarding')
@ApiAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly goals: GoalsService,
    private readonly clock: ClockService,
  ) {}

  @Post()
  @ApiOperation({
    summary: '送出問卷（建立目標與估計帳戶）',
    description: [
      '同一個資料庫交易內：建立目標（targetAmount ＝ monthlySpending × 300），並呼叫 C 的 createAccount 建立估計帳戶「現有資產（估計）」（bank、isEstimate: true、餘額 ＝ currentAssets，跳過時為 0）。',
      '已經完成過問卷回 409 ONBOARDING_ALREADY_DONE（兩個請求同時送出時，也只會有一個成功）。',
      '回傳和 GET /goal/progress 相同的內容，前端可以直接顯示目標頁。',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({ type: GoalProgressDto })
  @ApiErrors('VALIDATION_FAILED', 'ONBOARDING_ALREADY_DONE')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOnboardingDto,
  ): Promise<GoalProgressDto> {
    // 寫入的交易結束（commit）後才讀進度，才讀得到剛建立的目標與估計帳戶
    await this.onboarding.submit(user.id, dto);
    return this.goals.getGoalProgress(user.id, this.clock.today());
  }
}
