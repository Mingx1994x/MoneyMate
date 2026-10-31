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
  ApiBody,
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
import { BillListQueryDto } from './dto/bill-list-query.dto.js';
import {
  BillListResponseDto,
  BillResponseDto,
} from './dto/bill-response.dto.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { PayBillDto, PayBillResponseDto } from './dto/pay-bill.dto.js';
import {
  StopRecurrenceDto,
  StopRecurrenceResponseDto,
} from './dto/stop-recurrence.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';

/**
 * BILL-1 空殼，寫法同 LoansController。各端點的行為約定寫在 @ApiOperation 的 description，
 * BILL-2～7 實作時照著做；實作 PR 要拿掉 @ApiNotImplemented()。
 * 修改、刪除、繳費、取消繳費、停止重複都要先鎖定整個系列（FOR UPDATE），鎖定後重新讀取帳單再判斷。
 */
@ApiTags('bills')
@ApiAuth()
@Controller('bills')
export class BillsController {
  @Get()
  @ApiOperation({
    summary: '列出帳單',
    description: [
      'status 篩選 pending、paid、overdue；overdue 是待繳且到期日早於台北今天（計算出來的，不是資料庫欄位）。dueFrom、dueTo 篩選到期日（含頭尾，不是繳費日），dueFrom 晚於 dueTo 回 VALIDATION_FAILED（field: dueFrom）。',
      '排序：待繳在前，依 dueDate 由近到遠；已繳在後，依 dueDate 由新到舊；相同時再依 id。指定 status 時只套用該組的排序。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: BillListResponseDto })
  @ApiErrors('VALIDATION_FAILED')
  @ApiNotImplemented()
  findAll(@Query() _query: BillListQueryDto): BillListResponseDto {
    throw new NotImplementedException();
  }

  @Post()
  @ApiOperation({
    summary: '新增帳單',
    description: [
      '建立的帳單一律是待繳；不能建立已繳的帳單（要補記請記一筆交易）。dueDate 在過去也可以建立，建立後就是逾期；晚於台北今天加 50 年回 VALIDATION_FAILED（field: dueDate）。',
      'recurrence 沒帶是 none。dueDay、dueMonth 由後端從 dueDate 取：dueDay 是日；recurrence 是 yearly 時 dueMonth 是月，否則是 null。',
      '分類必須是支出分類，收入分類回 CATEGORY_TYPE_MISMATCH；帳戶已停用回 ACCOUNT_INACTIVE（field: accountId）。',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({ type: BillResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'AMOUNT_NOT_POSITIVE',
    'NAME_INVALID',
    ['ACCOUNT_NOT_FOUND', 400],
    'CATEGORY_NOT_FOUND',
    'CATEGORY_TYPE_MISMATCH',
    'ACCOUNT_INACTIVE',
  )
  @ApiNotImplemented()
  create(@Body() _dto: CreateBillDto): BillResponseDto {
    throw new NotImplementedException();
  }

  @Get(':id')
  @ApiOperation({
    summary: '取得單筆帳單',
    description:
      '不存在、屬於他人或 id 不是 UUID，一律回 404。已繳的帳單也可以讀。',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BillResponseDto })
  @ApiErrors('BILL_NOT_FOUND')
  @ApiNotImplemented()
  findOne(
    @Param('id', new ParseIdPipe('BILL_NOT_FOUND')) _id: string,
  ): BillResponseDto {
    throw new NotImplementedException();
  }

  @Patch(':id')
  @ApiOperation({
    summary: '修改帳單',
    description: [
      '沒傳的欄位保持原值；note 傳 null 代表清空，其他欄位傳 null 回 400。',
      "已繳的帳單只能改 name、note：其他欄位的值和現值不同時回 BILL_ALREADY_PAID，相同的忽略（前端送出整張表單也不會失敗）。amount 用數值比較，'15000' 和 '15000.00' 視為相同。",
      '待繳的帳單可以改全部欄位。accountId、categoryId 有變更才檢查擁有權與分類類型，帳戶有變更才檢查是否啟用。改 dueDate 時 dueDay 改成新日期的日、dueMonth 依 recurrence 重算；只改 recurrence 時只重算 dueMonth。',
      'dueDate 必須晚於同系列最後一張已繳帳單的 dueDate，也不可晚於台北今天加 50 年，否則回 VALIDATION_FAILED（field: dueDate）。',
      '改 amount 只影響這張與之後產生的下一期，已繳的歷史不變。',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BillResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'AMOUNT_NOT_POSITIVE',
    'NAME_INVALID',
    ['ACCOUNT_NOT_FOUND', 400],
    'CATEGORY_NOT_FOUND',
    'CATEGORY_TYPE_MISMATCH',
    'ACCOUNT_INACTIVE',
    'BILL_ALREADY_PAID',
    'BILL_NOT_FOUND',
  )
  @ApiNotImplemented()
  update(
    @Param('id', new ParseIdPipe('BILL_NOT_FOUND')) _id: string,
    @Body() _dto: UpdateBillDto,
  ): BillResponseDto {
    throw new NotImplementedException();
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: '刪除帳單（只限待繳）',
    description:
      '已繳的帳單回 BILL_ALREADY_PAID，要先取消繳費。待繳帳單是系列的最新一期，刪除後系列不再產生下一期，已繳的歷史保留。',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiErrors('BILL_ALREADY_PAID', 'BILL_NOT_FOUND')
  @ApiNotImplemented()
  remove(@Param('id', new ParseIdPipe('BILL_NOT_FOUND')) _id: string): void {
    throw new NotImplementedException();
  }

  @Post(':id/pay')
  @HttpCode(200)
  @ApiOperation({
    summary: '繳費',
    description: [
      'body 可以是空的：paidAmount 預設帳單的 amount，paidDate 預設台北今天；paidDate 晚於台北今天回 PAID_DATE_IN_FUTURE。',
      '在同一個資料庫交易內：建立一筆支出（帳戶、分類沿用帳單，金額是 paidAmount，日期是 paidDate；不檢查餘額）、帳單改為已繳；recurrence 不是 none 時建立下一期待繳帳單，放在 nextBill（不重複時是 null）。',
      '下一期的 amount 沿用預定金額（不是實繳金額），dueDate 從本期的 dueDate 推算（不是繳費日），所以逾期補繳後，下一期可能也已經逾期。',
      '已繳回 BILL_ALREADY_PAID：連按兩次也只會有一筆支出。扣款帳戶已停用回 ACCOUNT_INACTIVE；要用別的帳戶付，先用 PATCH 改掉待繳帳單的 accountId。',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: PayBillDto, required: false })
  @ApiOkResponse({ type: PayBillResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'AMOUNT_NOT_POSITIVE',
    'PAID_DATE_IN_FUTURE',
    'BILL_ALREADY_PAID',
    'ACCOUNT_INACTIVE',
    'BILL_NOT_FOUND',
  )
  @ApiNotImplemented()
  pay(
    @Param('id', new ParseIdPipe('BILL_NOT_FOUND')) _id: string,
    @Body() _dto: PayBillDto,
  ): PayBillResponseDto {
    throw new NotImplementedException();
  }

  @Post(':id/unpay')
  @HttpCode(200)
  @ApiOperation({
    summary: '取消繳費',
    description: [
      '刪除這張帳單產生的支出、帳單改回待繳並清空 paidAmount、paidDate；同系列的待繳帳單（繳費時產生的下一期）一起刪除。',
      '同系列的待繳帳單已經是不重複（停止重複時保留），或系列已經沒有待繳帳單（停止重複時刪除，或直接刪除待繳帳單）時，改回待繳的這張也改成不重複（dueMonth 改成 null），再繳費不會產生下一期。',
      '待繳的帳單回 BILL_NOT_PAID；同系列之後的帳單已繳回 NEXT_BILL_ALREADY_PAID（要從最新一期往回取消）；扣款帳戶已停用回 ACCOUNT_INACTIVE。',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BillResponseDto, description: '改回待繳的帳單' })
  @ApiErrors(
    'BILL_NOT_PAID',
    'NEXT_BILL_ALREADY_PAID',
    'ACCOUNT_INACTIVE',
    'BILL_NOT_FOUND',
  )
  @ApiNotImplemented()
  unpay(
    @Param('id', new ParseIdPipe('BILL_NOT_FOUND')) _id: string,
  ): BillResponseDto {
    throw new NotImplementedException();
  }

  @Post(':id/stop-recurrence')
  @HttpCode(200)
  @ApiOperation({
    summary: '停止重複',
    description: [
      '從系列的任何一張（包括已繳的歷史期）都可以停止，處理的是同系列的待繳帳單：keepCurrent 是 true 時保留它、改成不重複（dueMonth 改成 null）；false 時刪除它。已繳的歷史都不動。',
      '系列沒有待繳帳單時什麼都不做，回 stopped: false、bill: null。',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StopRecurrenceResponseDto })
  @ApiErrors('VALIDATION_FAILED', 'BILL_NOT_FOUND')
  @ApiNotImplemented()
  stopRecurrence(
    @Param('id', new ParseIdPipe('BILL_NOT_FOUND')) _id: string,
    @Body() _dto: StopRecurrenceDto,
  ): StopRecurrenceResponseDto {
    throw new NotImplementedException();
  }
}
