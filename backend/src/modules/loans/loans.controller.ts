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
import { ParseIdPipe } from '../../common/id.js';
import {
  ApiAuth,
  ApiErrors,
  ApiNotImplemented,
} from '../../common/swagger/api-decorators.js';
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

/**
 * LOAN-1 空殼：簽名、DTO 與 Swagger 標註是給 C、D 照著寫的完整範例。
 * - 空殼的 handler 只丟 NotImplementedException（501），不寫 async（沒有 await 時 oxlint 會擋）。
 * - 沒用到的參數加 _ 前綴，實作時拿掉；@CurrentUser() 由 AUTH-1 提供，實作時再加。
 * - 實作 PR 要拿掉 @ApiNotImplemented()。
 * 各端點的行為約定寫在 @ApiOperation 的 description（前端在 Swagger UI 看得到），實作時照著做。
 */
@ApiTags('loans')
@ApiAuth()
@Controller('loans')
export class LoansController {
  // 固定路徑要宣告在 :id 之前，否則會被 :id 接走、回 404 LOAN_NOT_FOUND
  @Get('payment-preview')
  @ApiOperation({
    summary: '試算建議每月還款與預估總利息',
    description: [
      '本息平均攤還（PRD 15.8）：每期月付四捨五入到元，最後一期吸收尾差。只計算，不讀寫資料庫。',
      '期數從台北本月算到結清日所在月份（含頭尾），至少 1，所以同一組參數的結果會隨月份改變。',
      '前端呼叫條件：餘額 > 0、利率有填、結清日合法而且不早於台北今天才呼叫；其他情況不呼叫，也不顯示總利息。建議 debounce 300ms，並取消前一次請求。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: LoanPaymentPreviewResponseDto })
  @ApiErrors('VALIDATION_FAILED', 'AMOUNT_INVALID', 'AMOUNT_NOT_POSITIVE')
  @ApiNotImplemented()
  paymentPreview(
    @Query() _query: LoanPaymentPreviewQueryDto,
  ): LoanPaymentPreviewResponseDto {
    throw new NotImplementedException();
  }

  @Get()
  @ApiOperation({
    summary: '列出貸款',
    description:
      '包含已結清的貸款，不分頁。排序：active 在前，同一組內依 createdAt 由新到舊，相同時再依 id。',
  })
  @ApiOkResponse({ type: LoanListResponseDto })
  @ApiNotImplemented()
  findAll(): LoanListResponseDto {
    throw new NotImplementedException();
  }

  @Post()
  @ApiOperation({
    summary: '新增貸款',
    description: [
      '沒帶 monthlyPayment 時，後端依年利率自動計算。以下情況回 LOAN_MONTHLY_PAYMENT_REQUIRED：沒帶 monthlyPayment，而且 interestRate 沒帶或為 null；或 outstandingBalance 是 0（算不出大於 0 的月付）。前端表單一律帶 monthlyPayment（用試算結果預填）。',
      '結清日早於台北今天時 status 必須是 closed，否則回 LOAN_END_DATE_IN_PAST；晚於台北今天加 50 年回 VALIDATION_FAILED（field: endDate）。',
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
  @ApiNotImplemented()
  create(@Body() _dto: CreateLoanDto): LoanResponseDto {
    throw new NotImplementedException();
  }

  @Get(':id')
  @ApiOperation({
    summary: '取得單筆貸款',
    description: '不存在、屬於他人或 id 不是 UUID，一律回 404。',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LoanResponseDto })
  @ApiErrors('LOAN_NOT_FOUND')
  @ApiNotImplemented()
  findOne(
    @Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) _id: string,
  ): LoanResponseDto {
    throw new NotImplementedException();
  }

  @Patch(':id')
  @ApiOperation({
    summary: '修改貸款',
    description: [
      '沒傳的欄位保持原值；interestRate、note 傳 null 代表清空，其他欄位傳 null 回 400。',
      '不自動重算 monthlyPayment：前端改了餘額、利率或結清日時，自己重新試算並帶上新的月付。',
      '用「原值合併請求」後的結果檢查：status 不是 closed 而且結清日早於台北今天，回 LOAN_END_DATE_IN_PAST（包含把 closed 改回 active 但結清日沒改）；結清日晚於台北今天加 50 年回 VALIDATION_FAILED。',
      '請求有帶 outstandingBalance 就更新 balanceUpdatedAt，即使數字相同。',
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
  @ApiNotImplemented()
  update(
    @Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) _id: string,
    @Body() _dto: UpdateLoanDto,
  ): LoanResponseDto {
    throw new NotImplementedException();
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
  @ApiNotImplemented()
  remove(@Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) _id: string): void {
    throw new NotImplementedException();
  }
}
