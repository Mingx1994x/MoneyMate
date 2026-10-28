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
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { TransactionListQueryDto } from './dto/transaction-list-query.dto.js';
import {
  TransactionListResponseDto,
  TransactionResponseDto,
} from './dto/transaction-response.dto.js';
import { UpdateTransactionDto } from './dto/update-transaction.dto.js';

/**
 * transactions 空殼（C）：照 loans 範例寫。
 * - handler 只丟 NotImplementedException（501），不寫 async。
 * - 沒用到的參數加 _ 前綴，實作時拿掉；@CurrentUser() 由 AUTH-1 提供，實作時再加。
 * - 實作 PR 要拿掉 @ApiNotImplemented()。
 * 快速記帳、繳卡費都走 POST /transactions，沒有另外的端點。
 */
@ApiTags('transactions')
@ApiAuth()
@Controller('transactions')
export class TransactionsController {
  @Get()
  @ApiOperation({
    summary: '列出交易（篩選＋分頁）',
    description: [
      '篩選條件都是選填，同時帶多個時取交集。分頁：page 預設 1、pageSize 預設 20、上限 100。',
      '排序：transactionDate 由新到舊，相同時依 createdAt 由新到舊，再依 id。包含未來日期的交易。',
      'categoryId、accountId 不是 UUID，或不屬於登入者（系統分類算存在）時回 400 CATEGORY_NOT_FOUND／ACCOUNT_NOT_FOUND；dateTo 早於 dateFrom 回 400 VALIDATION_FAILED（field: dateTo）。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: TransactionListResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    ['ACCOUNT_NOT_FOUND', 400],
    'CATEGORY_NOT_FOUND',
  )
  @ApiNotImplemented()
  findAll(
    @Query() _query: TransactionListQueryDto,
  ): TransactionListResponseDto {
    throw new NotImplementedException();
  }

  @Post()
  @ApiOperation({
    summary: '新增交易（快速記帳、繳卡費也走這支）',
    description: [
      '收入／支出：必須有 categoryId，類型要相同（否則 CATEGORY_TYPE_MISMATCH），不可帶 toAccountId。轉帳：必須有 toAccountId、不可帶 categoryId，兩個帳戶不同（否則 TRANSFER_SAME_ACCOUNT）。類型與欄位不符回 TRANSACTION_FIELDS_MISMATCH（field 為不符合的欄位）。',
      'accountId、toAccountId、categoryId 必須屬於登入者（分類可以是系統分類），否則回 400 ACCOUNT_NOT_FOUND／CATEGORY_NOT_FOUND；任一帳戶停用時回 ACCOUNT_INACTIVE。',
      'transactionDate 不帶時是台北今天。繳卡費＝銀行 → 信用卡的 transfer，不計入收支（PRD 15.10）。',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({ type: TransactionResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'AMOUNT_NOT_POSITIVE',
    'TRANSACTION_FIELDS_MISMATCH',
    'TRANSFER_SAME_ACCOUNT',
    'CATEGORY_TYPE_MISMATCH',
    'CATEGORY_NOT_FOUND',
    ['ACCOUNT_NOT_FOUND', 400],
    'ACCOUNT_INACTIVE',
  )
  @ApiNotImplemented()
  create(@Body() _dto: CreateTransactionDto): TransactionResponseDto {
    throw new NotImplementedException();
  }

  @Get(':id')
  @ApiOperation({
    summary: '取得單筆交易',
    description: '不存在、屬於他人或 id 不是 UUID，一律回 404。',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TransactionResponseDto })
  @ApiErrors('TRANSACTION_NOT_FOUND')
  @ApiNotImplemented()
  findOne(
    @Param('id', new ParseIdPipe('TRANSACTION_NOT_FOUND')) _id: string,
  ): TransactionResponseDto {
    throw new NotImplementedException();
  }

  @Patch(':id')
  @ApiOperation({
    summary: '修改交易',
    description: [
      '沒傳的欄位保持原值；categoryId、toAccountId、note 傳 null 代表清空，其他欄位傳 null 回 400。',
      '可以改交易類型：用「原值合併請求」後的結果檢查欄位規則（同新增），例如支出改轉帳時要帶 toAccountId，並把 categoryId 設成 null。',
      '帳單產生的交易回 BILL_LINKED_TRANSACTION。原本或修改後的帳戶（轉出、轉入任一方）是停用帳戶時回 ACCOUNT_INACTIVE（PRD 15.11）。',
    ].join('\n\n'),
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TransactionResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AMOUNT_INVALID',
    'AMOUNT_NOT_POSITIVE',
    'TRANSACTION_FIELDS_MISMATCH',
    'TRANSFER_SAME_ACCOUNT',
    'CATEGORY_TYPE_MISMATCH',
    'CATEGORY_NOT_FOUND',
    ['ACCOUNT_NOT_FOUND', 400],
    'ACCOUNT_INACTIVE',
    'BILL_LINKED_TRANSACTION',
    'TRANSACTION_NOT_FOUND',
  )
  @ApiNotImplemented()
  update(
    @Param('id', new ParseIdPipe('TRANSACTION_NOT_FOUND')) _id: string,
    @Body() _dto: UpdateTransactionDto,
  ): TransactionResponseDto {
    throw new NotImplementedException();
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: '刪除交易',
    description:
      '帳單產生的交易回 BILL_LINKED_TRANSACTION（請到帳單取消繳費）；轉出或轉入帳戶停用時回 ACCOUNT_INACTIVE。',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiErrors(
    'ACCOUNT_INACTIVE',
    'BILL_LINKED_TRANSACTION',
    'TRANSACTION_NOT_FOUND',
  )
  @ApiNotImplemented()
  remove(
    @Param('id', new ParseIdPipe('TRANSACTION_NOT_FOUND')) _id: string,
  ): void {
    throw new NotImplementedException();
  }
}
