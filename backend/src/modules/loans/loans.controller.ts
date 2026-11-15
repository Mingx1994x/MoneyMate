import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ApiAuth, ApiErrors } from '../../common/swagger/api-decorators.js';
import { CurrentUser, type AuthUser } from '../auth/index.js';
import { CreateLoanDto } from './dto/create-loan.dto.js';
import {
  LoanPaymentPreviewQueryDto,
  LoanPaymentPreviewResponseDto,
} from './dto/loan-payment-preview.dto.js';
import {
  LoanListResponseDto,
  LoanResponseDto,
} from './dto/loan-response.dto.js';
import { UpdateLoanDto } from './dto/update-loan.dto.js';
import { LoansService } from './loans.service.js';

/**
 * 貸款端點（LOAN-2、LOAN-4）。各端點的行為約定寫在 @ApiOperation 的 description（前端在 Swagger UI 看得到）。
 * 只能讀寫登入者自己的貸款；:id 不是 UUID、不存在、屬於他人一律 404 LOAN_NOT_FOUND。
 */
@ApiTags('loans')
@ApiAuth()
@Controller('loans')
export class LoansController {
  constructor(
    private readonly loans: LoansService,
    private readonly clock: ClockService,
  ) {}

  // 固定路徑要宣告在 :id 之前，否則會被 :id 接走、回 404 LOAN_NOT_FOUND
  @Get('payment-preview')
  @ApiOperation({
    summary: '試算建議每月還款與預估總利息',
    description: [
      '本息平均攤還（PRD 15.8）：每期月付四捨五入到元，最後一期吸收尾差。只計算，不讀寫資料庫。',
      '期數（D-E-002）：台北今天（含）到結清日（含）之間的還款日個數，至少 1。每月還款日是 paymentDay，29–31 遇短月用當月最後一天；本月的還款日已過就從下個月算，今天剛好是還款日時算一期；晚於結清日的還款日不算。同一組參數的結果會隨日期改變。',
      '結清日早於台北今天時期數視為 1，不報錯；晚於台北今天加 50 年回 VALIDATION_FAILED（field: endDate）。',
      '前端呼叫條件：餘額 > 0、利率有填、繳款日有填、結清日合法而且不早於台北今天才呼叫；其他情況不呼叫，也不顯示總利息。改了繳款日也要重新試算。建議 debounce 300ms，並取消前一次請求。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: LoanPaymentPreviewResponseDto })
  @ApiErrors('VALIDATION_FAILED', 'AMOUNT_INVALID', 'AMOUNT_NOT_POSITIVE')
  paymentPreview(
    @Query() query: LoanPaymentPreviewQueryDto,
  ): LoanPaymentPreviewResponseDto {
    return this.loans.paymentPreview(query, this.clock.today());
  }

  @Get()
  @ApiOperation({
    summary: '列出貸款',
    description:
      '包含已結清的貸款，不分頁。排序：active 在前，同一組內依 createdAt 由新到舊，相同時再依 id。',
  })
  @ApiOkResponse({ type: LoanListResponseDto })
  async findAll(@CurrentUser() user: AuthUser): Promise<LoanListResponseDto> {
    return { items: await this.loans.findAll(user.id) };
  }

  @Post()
  @ApiOperation({
    summary: '新增貸款',
    description: [
      '沒帶 monthlyPayment 時，後端依年利率自動計算（期數規則同試算，用 body 的 paymentDay）。以下情況回 LOAN_MONTHLY_PAYMENT_REQUIRED：沒帶 monthlyPayment，而且 interestRate 沒帶或為 null；或算不出大於 0 的月付（例如 outstandingBalance 是 0）。前端表單一律帶 monthlyPayment（用試算結果預填）。',
      '有帶 monthlyPayment 就照存，不檢查是否等於試算結果，也不要求小於未償餘額。',
      '結清日早於台北今天時 status 必須是 closed，否則回 LOAN_END_DATE_IN_PAST；晚於台北今天加 50 年回 VALIDATION_FAILED（field: endDate）。',
      'status 是 closed 時不檢查 outstandingBalance，照存使用者填的值；已結清的貸款不算進淨資產與 Dashboard（D-E-003）。',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({ type: LoanResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'AMOUNT_NOT_POSITIVE',
    'AMOUNT_NEGATIVE',
    'NAME_INVALID',
    'LOAN_END_DATE_IN_PAST',
    'LOAN_MONTHLY_PAYMENT_REQUIRED',
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateLoanDto,
  ): Promise<LoanResponseDto> {
    return this.loans.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: '取得單筆貸款',
    description:
      '已結清的貸款也查得到。不存在、屬於他人或 id 不是 UUID，一律回 404。',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LoanResponseDto })
  @ApiErrors('LOAN_NOT_FOUND')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) id: string,
  ): Promise<LoanResponseDto> {
    return this.loans.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '修改貸款',
    description: [
      '沒傳的欄位保持原值；interestRate、note 傳 null 代表清空，其他欄位傳 null 回 400。',
      '不自動重算 monthlyPayment（D-E-001）：沒帶就保持原值。前端改了餘額、利率、結清日或繳款日時，自己重新試算，讓使用者決定要不要套用新的月付。',
      'endDate 或 status 跟原值不同時，才用「原值合併請求」後的結果檢查：status 不是 closed 而且結清日早於台北今天，回 LOAN_END_DATE_IN_PAST（包含把 closed 改回 active 但結清日沒改）。比對的是值：整份送出、endDate 寫同一天不算改；結清日已過但只改其他欄位不擋（D-E-004）。',
      '合併後的結清日晚於台北今天加 50 年回 VALIDATION_FAILED（field: endDate）。',
      'status 是 closed 時不檢查、也不自動改 outstandingBalance（D-E-003）。',
      'outstandingBalance 跟原值不同才更新 balanceUpdatedAt；沒帶或數字相同（"317200" 和 "317200.00" 視為相同）都不動。',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LoanResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'AMOUNT_NOT_POSITIVE',
    'AMOUNT_NEGATIVE',
    'NAME_INVALID',
    'LOAN_END_DATE_IN_PAST',
    'LOAN_NOT_FOUND',
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) id: string,
    @Body() dto: UpdateLoanDto,
  ): Promise<LoanResponseDto> {
    return this.loans.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: '刪除貸款（不會刪除帳單）',
    description:
      'active 的貸款也可以刪。貸款和帳單、交易沒有關聯，刪除不影響它們。',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiErrors('LOAN_NOT_FOUND')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) id: string,
  ): Promise<void> {
    return this.loans.remove(user.id, id);
  }
}
