import { Injectable } from '@nestjs/common';
import { fromDbDate, toDbDate, type DateOnly } from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { toMoney, toMoneyString } from '../../common/money.js';
import {
  CategoryType,
  Prisma,
  PrismaService,
  TransactionType,
  type PrismaTx,
  type Transaction,
} from '../../prisma/index.js';
import { AccountsService } from '../accounts/index.js';
import { CategoriesService } from '../categories/index.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';

/** createBillTransaction 的輸入（E 的帳單繳費，PRD 16.1） */
export interface BillTransactionData {
  billId: string;
  /** 帳單的扣款帳戶 */
  accountId: string;
  /** 帳單的支出分類（建立帳單時已用 assertAccountAndCategoryOwned 檢查過） */
  categoryId: string;
  /** 實繳金額 paidAmount，> 0 */
  amount: Prisma.Decimal;
  /** 實繳日期 paidDate；不晚於今天由 E 檢查（PAID_DATE_IN_FUTURE） */
  transactionDate: DateOnly;
  note?: string | null;
}
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

  /**
   * 給 E 的帳單繳費（PRD 16.1、16.7）：在 E 開的資料庫交易內建立一筆 expense，bill_id 指向帳單。
   * - 扣款帳戶停用：409 ACCOUNT_INACTIVE，details 是 []（扣款帳戶不是 body 的欄位，D-010）。
   * - 扣款帳戶不存在或不屬於這位使用者：程式錯誤（帳單建立時已檢查，複合外鍵也擋），丟 Error → 500。
   * - bill_id 有唯一約束：同一張帳單重複建立會撞約束（E 鎖住系列並確認 pending 後才呼叫，正常不會發生）。
   */
  async createBillTransaction(
    tx: PrismaTx,
    userId: string,
    data: BillTransactionData,
  ): Promise<{ id: string }> {
    if (!data.amount.gt(0)) {
      throw new Error('createBillTransaction: 金額必須大於 0');
    }
    const account = await tx.account.findFirst({
      where: { id: data.accountId, userId },
      select: { isActive: true },
    });
    if (!account) {
      throw new Error(
        'createBillTransaction: 扣款帳戶不存在或不屬於這位使用者',
      );
    }
    if (!account.isActive) throw new AppException('ACCOUNT_INACTIVE');

    return tx.transaction.create({
      data: {
        userId,
        accountId: data.accountId,
        transactionType: TransactionType.expense,
        amount: data.amount,
        categoryId: data.categoryId,
        transactionDate: toDbDate(data.transactionDate),
        note: data.note ?? null,
        billId: data.billId,
      },
      select: { id: true },
    });
  }

  /**
   * 給 E 的取消繳費（PRD 16.2、16.7）：在 E 開的資料庫交易內刪除這張帳單產生的支出。
   * - 扣款帳戶停用：409 ACCOUNT_INACTIVE，details 是 []（PRD 15.11、D-010）。
   * - 找不到這張帳單的交易：已繳帳單一定有交易，找不到代表資料不一致，丟 Error → 500。
   */
  async deleteBillTransaction(
    tx: PrismaTx,
    userId: string,
    billId: string,
  ): Promise<void> {
    const row = await tx.transaction.findFirst({
      where: { billId, userId },
      select: { id: true, account: { select: { isActive: true } } },
    });
    if (!row) {
      throw new Error('deleteBillTransaction: 找不到這張帳單產生的交易');
    }
    if (!row.account.isActive) throw new AppException('ACCOUNT_INACTIVE');
    await tx.transaction.delete({ where: { id: row.id } });
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
