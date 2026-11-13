import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-decorators.js';
import { ClockService } from '../../clock/clock.service.js';
import { CurrentUser, type AuthUser } from '../auth/index.js';
import { GoalProgressDto } from './dto/goal-progress.dto.js';
import { GoalDto } from './dto/goal.dto.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';
import { GoalsService } from './goals.service.js';

/**
 * GOAL：單數資源，沒有 :id。
 * 還沒完成問卷（沒有目標資料）時三支都回 409 ONBOARDING_REQUIRED。
 */
@ApiTags('goal')
@ApiAuth()
@Controller('goal')
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    private readonly clock: ClockService,
  ) {}

  @Get()
  @ApiOperation({ summary: '取得目標設定' })
  @ApiOkResponse({ type: GoalDto })
  @ApiErrors('ONBOARDING_REQUIRED')
  findOne(@CurrentUser() user: AuthUser): Promise<GoalDto> {
    return this.goals.findOne(user.id);
  }

  @Patch()
  @ApiOperation({
    summary: '修改目標（每月花費、出生年、自估每月儲蓄）',
    description: [
      '沒傳的欄位保持原值；birthYear、estMonthlySaving 傳 null 代表清空，monthlySpending 傳 null 回 400。',
      '改了 monthlySpending 時，targetAmount 由後端重算為 × 300（前端不能直接改目標金額）。',
      'birthYear 晚於台北的今年回 VALIDATION_FAILED（field: birthYear）。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: GoalDto })
  @ApiErrors('VALIDATION_FAILED', 'AMOUNT_INVALID', 'ONBOARDING_REQUIRED')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateGoalDto,
  ): Promise<GoalDto> {
    return this.goals.update(user.id, dto, this.clock.today());
  }

  @Get('progress')
  @ApiOperation({
    summary: '目標進度與財富自由年齡',
    description: [
      '目前金額 ＝ 帳戶合計（PRD 15.1：啟用帳戶、含估計帳戶與信用卡負值、不扣貸款、不含未來交易），「今天」用台北時間。',
      '里程碑照 PRD 15.4；財富自由年齡照 PRD 15.7（實質報酬 3.92%、年儲蓄年底投入、100 歲上限）。驗算案例：40 歲、年支出 60 萬、年儲蓄 60 萬、資產 500 萬 → 51 歲。',
      '年儲蓄：最近 6 個完整月（不含本月）裡有記帳（收入或支出不是 0）的月有 3 個以上時，用那些月的平均（收入 − 支出）× 12（savingSource: actual），沒記帳的月不算進平均；否則用 estMonthlySaving × 12（estimate）；都沒有時 fireAgeStatus 是 need_saving。',
      '狀態的判斷順序：achieved → need_birth_year → need_saving → unreachable → over_100 → ok。已達成（現在資產 ≥ FIRE 目標）不需要出生年和儲蓄，所以最先判斷，沒填出生年也是 achieved（PRD 15.7）；其他狀態 fireAge 是 null。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: GoalProgressDto })
  @ApiErrors('ONBOARDING_REQUIRED')
  progress(@CurrentUser() user: AuthUser): Promise<GoalProgressDto> {
    return this.goals.getGoalProgress(user.id, this.clock.today());
  }
}
