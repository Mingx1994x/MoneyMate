import {
  Body,
  Controller,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiAuth,
  ApiErrors,
  ApiNotImplemented,
} from '../../common/swagger/api-decorators.js';
import { GoalProgressDto } from '../goals/dto/goal-progress.dto.js';
import { CreateOnboardingDto } from './dto/create-onboarding.dto.js';

/** ONB 空殼：實作在 W4（等 C 的 createAccount）。 */
@ApiTags('onboarding')
@ApiAuth()
@Controller('onboarding')
export class OnboardingController {
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
  @ApiNotImplemented()
  create(@Body() _dto: CreateOnboardingDto): GoalProgressDto {
    throw new NotImplementedException();
  }
}
