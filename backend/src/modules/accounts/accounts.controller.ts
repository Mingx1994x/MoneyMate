import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ClockService } from '../../clock/clock.service.js';
import { ParseIdPipe } from '../../common/id.js';
import {
  ApiAuth,
  ApiErrors,
  ApiNotImplemented,
} from '../../common/swagger/api-decorators.js';
import { CurrentUser, type AuthUser } from '../auth/index.js';
import {
  AccountDeleteQueryDto,
  AccountListQueryDto,
} from './dto/account-query.dto.js';
import {
  AccountListResponseDto,
  AccountResponseDto,
} from './dto/account-response.dto.js';
import { AccountsService } from './accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { UpdateAccountDto } from './dto/update-account.dto.js';

/**
 * accounts（C）。已實作：列表、新增、單筆；修改、刪除在 W3（暫時回 501）。
 * - 「今天」用 ClockService.today()，一個請求只取一次往下傳。
 * - 餘額、合計一律由 FinanceCalcService 計算（PRD 15.1），這裡不另外寫公式。
 */
@ApiTags('accounts')
@ApiAuth()
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly clock: ClockService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '列出帳戶',
    description: [
      '不分頁。預設只列啟用中的帳戶；帶 includeInactive=true 才一併列出停用的帳戶。',
      '排序：啟用中在前，同一組內依 createdAt 由舊到新，相同時再依 id。',
      '每筆含 currentBalance（只計入日期 ≤ 台北今天的交易）與 hasTransactions。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: AccountListResponseDto })
  @ApiErrors('VALIDATION_FAILED')
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: AccountListQueryDto,
  ): Promise<AccountListResponseDto> {
    const items = await this.accounts.findAll(
      user.id,
      this.clock.today(),
      query.includeInactive === true,
    );
    return { items };
  }

  @Post()
  @ApiOperation({
    summary: '新增帳戶',
    description: [
      'currency 固定 TWD。只有 credit_card 的 openingBalance 可以是負數，其他類型為負數時回 OPENING_BALANCE_NEGATIVE（估計帳戶只由問卷建立，不能從這裡新增）。',
      'deductFromEstimate = true 時，同一個資料庫交易內從估計帳戶扣掉 min(openingBalance, 估計帳戶目前餘額)，並記在新帳戶的 deductedFromEstimate；估計帳戶目前餘額扣到 0 時自動停用。新增失敗時估計帳戶不會被扣（PRD 15.9）。',
      '實際扣除金額 ≤ 0 時不扣，忽略 deductFromEstimate，deductedFromEstimate 存 null（不存 0）：包含 openingBalance ≤ 0、估計帳戶目前餘額 ≤ 0（例如估計帳戶有支出交易）、沒有估計帳戶，或估計帳戶已停用。這些情況不是錯誤，照常建立帳戶。',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({ type: AccountResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'NAME_INVALID',
    'OPENING_BALANCE_NEGATIVE',
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accounts.create(user.id, dto, this.clock.today());
  }

  @Get(':id')
  @ApiOperation({
    summary: '取得單筆帳戶',
    description:
      '停用的帳戶也查得到。不存在、屬於他人或 id 不是 UUID，一律回 404。',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiErrors('ACCOUNT_NOT_FOUND')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseIdPipe('ACCOUNT_NOT_FOUND')) id: string,
  ): Promise<AccountResponseDto> {
    return this.accounts.findOne(user.id, id, this.clock.today());
  }

  @Patch(':id')
  @ApiOperation({
    summary: '修改、停用或重新啟用帳戶',
    description: [
      '沒傳的欄位保持原值；note 傳 null 代表清空，其他欄位傳 null 回 400。accountType 不能改。',
      '停用的帳戶只能重新啟用：請求只帶 isActive = true 時通過；帶了其他欄位回 ACCOUNT_INACTIVE（先重新啟用，再修改）。',
      '停用（isActive = false）：目前餘額必須為 0，而且沒有未來日期的交易，否則回 ACCOUNT_DEACTIVATE_BLOCKED。停用不會把扣掉的估計值加回（PRD 15.9）。',
      '修改 openingBalance 後目前餘額跟著變動；credit_card 與估計帳戶可以是負數，其他類型改成負數回 OPENING_BALANCE_NEGATIVE。',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'NAME_INVALID',
    'OPENING_BALANCE_NEGATIVE',
    'ACCOUNT_DEACTIVATE_BLOCKED',
    'ACCOUNT_INACTIVE',
    'ACCOUNT_NOT_FOUND',
  )
  @ApiNotImplemented()
  update(
    @Param('id', new ParseIdPipe('ACCOUNT_NOT_FOUND')) _id: string,
    @Body() _dto: UpdateAccountDto,
  ): AccountResponseDto {
    throw new NotImplementedException();
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: '刪除帳戶',
    description: [
      '只限沒有任何交易（轉出或轉入）、也沒有被帳單使用的帳戶，否則回 ACCOUNT_IN_USE，請改用停用。',
      '帶 addBackToEstimate=true 而且帳戶有 deductedFromEstimate 時，在同一個資料庫交易內把金額加回估計帳戶；估計帳戶已停用就重新啟用（PRD 15.9）。沒帶或 false 時不加回。',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiErrors('VALIDATION_FAILED', 'ACCOUNT_IN_USE', 'ACCOUNT_NOT_FOUND')
  @ApiNotImplemented()
  remove(
    @Param('id', new ParseIdPipe('ACCOUNT_NOT_FOUND')) _id: string,
    @Query() _query: AccountDeleteQueryDto,
  ): void {
    throw new NotImplementedException();
  }
}
