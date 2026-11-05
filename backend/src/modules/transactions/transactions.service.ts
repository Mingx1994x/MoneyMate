import { Injectable } from '@nestjs/common';
import { fromDbDate, toDbDate, type DateOnly } from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { toMoney, toMoneyString } from '../../common/money.js';
import {
  CategoryType,
  Prisma,
  PrismaService,
  TransactionType,
  type Transaction,
} from '../../prisma/index.js';
import { AccountsService } from '../accounts/index.js';
import { CategoriesService } from '../categories/index.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';
import type { TransactionListQueryDto } from './dto/transaction-list-query.dto.js';
import type {
  TransactionListResponseDto,
  TransactionResponseDto,
} from './dto/transaction-response.dto.js';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
  ) {}

  /**
   * GET /transactions：篩選條件取交集；排序 transactionDate 由新到舊，再依 createdAt、id 由新到舊。
   * 包含未來日期的交易。categoryId、accountId 不屬於登入者時回 400（不洩漏是否存在）。
   */
  async findAll(
    userId: string,
    query: TransactionListQueryDto,
  ): Promise<TransactionListResponseDto> {
    if (query.dateFrom && query.dateTo && query.dateTo < query.dateFrom) {
      throw AppException.forField('VALIDATION_FAILED', 'dateTo');
    }
    if (query.accountId) {
      const owned = await this.prisma.account.findFirst({
        where: { id: query.accountId, userId },
        select: { id: true },
      });
      if (!owned) {
        throw AppException.forField('ACCOUNT_NOT_FOUND', 'accountId', 400);
      }
    }
    if (query.categoryId) {
      const visible = await this.prisma.category.findFirst({
        where: { id: query.categoryId, OR: [{ userId: null }, { userId }] },
        select: { id: true },
      });
      if (!visible) {
        throw AppException.forField('CATEGORY_NOT_FOUND', 'categoryId');
      }
    }

    const where: Prisma.TransactionWhereInput = {
      userId,
      ...(query.transactionType
        ? { transactionType: query.transactionType }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.accountId
        ? {
            OR: [
              { accountId: query.accountId },
              { toAccountId: query.accountId },
            ],
          }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            transactionDate: {
              ...(query.dateFrom ? { gte: toDbDate(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: toDbDate(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: [
          { transactionDate: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map(toResponse),
    };
  }

  /** GET /transactions/:id：不存在或屬於他人回 404 */
  async findOne(userId: string, id: string): Promise<TransactionResponseDto> {
    const row = await this.prisma.transaction.findFirst({
      where: { id, userId },
    });
    if (!row) throw new AppException('TRANSACTION_NOT_FOUND');
    return toResponse(row);
  }

  /**
   * POST /transactions（快速記帳、繳卡費也走這支）。檢查順序：
   * 1. 類型與欄位（TRANSACTION_FIELDS_MISMATCH）、轉帳不能轉給同一個帳戶（TRANSFER_SAME_ACCOUNT）
   * 2. 帳戶屬於登入者且啟用中（ACCOUNT_NOT_FOUND 400／ACCOUNT_INACTIVE）
   * 3. 分類可用且類型相同（CATEGORY_NOT_FOUND／CATEGORY_TYPE_MISMATCH）
   * transactionDate 不帶時是台北今天。
   */
  async create(
    userId: string,
    dto: CreateTransactionDto,
    today: DateOnly,
  ): Promise<TransactionResponseDto> {
    const isTransfer = dto.transactionType === TransactionType.transfer;
    const categoryId = dto.categoryId ?? null;
    const toAccountId = dto.toAccountId ?? null;

    if (isTransfer) {
      if (categoryId !== null) {
        throw AppException.forField(
          'TRANSACTION_FIELDS_MISMATCH',
          'categoryId',
        );
      }
      if (toAccountId === null) {
        throw AppException.forField(
          'TRANSACTION_FIELDS_MISMATCH',
          'toAccountId',
        );
      }
      if (toAccountId === dto.accountId) {
        throw AppException.forField('TRANSFER_SAME_ACCOUNT', 'toAccountId');
      }
    } else {
      if (toAccountId !== null) {
        throw AppException.forField(
          'TRANSACTION_FIELDS_MISMATCH',
          'toAccountId',
        );
      }
      if (categoryId === null) {
        throw AppException.forField(
          'TRANSACTION_FIELDS_MISMATCH',
          'categoryId',
        );
      }
    }

    await this.accounts.assertActiveAccount(userId, dto.accountId, 'accountId');
    if (toAccountId !== null) {
      await this.accounts.assertActiveAccount(
        userId,
        toAccountId,
        'toAccountId',
      );
    }
    if (categoryId !== null) {
      const type =
        dto.transactionType === TransactionType.income
          ? CategoryType.income
          : CategoryType.expense;
      await this.categories.assertUsable(userId, categoryId, type);
    }

    const row = await this.prisma.transaction.create({
      data: {
        userId,
        accountId: dto.accountId,
        transactionType: dto.transactionType,
        amount: toMoney(dto.amount),
        categoryId,
        toAccountId,
        transactionDate: toDbDate(dto.transactionDate ?? today),
        note: dto.note ?? null,
      },
    });
    return toResponse(row);
  }
}

function toResponse(t: Transaction): TransactionResponseDto {
  return {
    id: t.id,
    transactionType: t.transactionType,
    amount: toMoneyString(t.amount),
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    categoryId: t.categoryId,
    transactionDate: fromDbDate(t.transactionDate),
    note: t.note,
    billId: t.billId,
    isBillGenerated: t.billId !== null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
