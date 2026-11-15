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
import type { UpdateTransactionDto } from './dto/update-transaction.dto.js';
import { AccountsService } from '../accounts/index.js';
import { CategoriesService } from '../categories/index.js';
import type { CreateTransactionDto } from './dto/create-transaction.dto.js';
import type { TransactionListQueryDto } from './dto/transaction-list-query.dto.js';
import type {
  TransactionListResponseDto,
  TransactionResponseDto,
} from './dto/transaction-response.dto.js';

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
  /** 帳單名稱（繳費當下的名稱，之後改帳單名稱不同步；Q14）。交易沒有名稱欄位，交易頁靠它分辨是哪張帳單 */
  note: string;
}

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
   * 先鎖住相關帳戶（lockAccounts），和停用帳戶排隊，避免寫進剛被停用的帳戶。
   */
  async create(
    userId: string,
    dto: CreateTransactionDto,
    today: DateOnly,
  ): Promise<TransactionResponseDto> {
    const fields: TransactionFields = {
      transactionType: dto.transactionType,
      accountId: dto.accountId,
      toAccountId: dto.toAccountId ?? null,
      categoryId: dto.categoryId ?? null,
    };
    assertFieldsMatchType(fields);

    return this.prisma.$transaction(async (tx) => {
      await lockAccounts(tx, userId, [fields.accountId, fields.toAccountId]);
      await this.assertAccountsUsable(tx, userId, fields);
      await this.assertCategoryUsable(tx, userId, fields);

      const row = await tx.transaction.create({
        data: {
          userId,
          ...fields,
          amount: toMoney(dto.amount),
          transactionDate: toDbDate(dto.transactionDate ?? today),
          note: dto.note ?? null,
        },
      });
      return toResponse(row);
    });
  }

  /**
   * PATCH /transactions/:id（PRD 15.11、16.5、AC-26）。檢查順序：
   * 1. 交易存在且屬於登入者（TRANSACTION_NOT_FOUND 404）
   * 2. 不是帳單產生的（BILL_LINKED_TRANSACTION 409）
   * 3. 原本的轉出、轉入帳戶都啟用中：停用帳戶的交易不能改，也不能移出（ACCOUNT_INACTIVE）
   * 4. 原值＋請求合併後，跑和新增一樣的檢查；帳戶有變才檢查新帳戶，分類或類型有變才檢查分類
   *    （沒改的分類即使之後停用，也可以只改金額、日期、備註）
   * 交易列與相關帳戶都先鎖住：同一筆同時修改、或修改時帳戶被停用，都會排隊。
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockOwnTransaction(tx, userId, id);

      const merged: TransactionFields = {
        transactionType: dto.transactionType ?? row.transactionType,
        accountId: dto.accountId ?? row.accountId,
        toAccountId:
          dto.toAccountId !== undefined ? dto.toAccountId : row.toAccountId,
        categoryId:
          dto.categoryId !== undefined ? dto.categoryId : row.categoryId,
      };
      await lockAccounts(tx, userId, [
        row.accountId,
        row.toAccountId,
        merged.accountId,
        merged.toAccountId,
      ]);

      // 3. 停用帳戶的交易不能改（轉出或轉入任一方）
      await this.assertOriginalAccountsActive(tx, userId, row, true);

      // 4. 合併後的檢查
      assertFieldsMatchType(merged);
      const accountChanged =
        merged.accountId !== row.accountId ||
        merged.toAccountId !== row.toAccountId;
      if (accountChanged) await this.assertAccountsUsable(tx, userId, merged);
      const categoryChanged =
        merged.categoryId !== row.categoryId ||
        merged.transactionType !== row.transactionType;
      if (categoryChanged) await this.assertCategoryUsable(tx, userId, merged);

      const updated = await tx.transaction.update({
        where: { id: row.id },
        data: {
          ...merged,
          ...(dto.amount !== undefined ? { amount: toMoney(dto.amount) } : {}),
          ...(dto.transactionDate !== undefined
            ? { transactionDate: toDbDate(dto.transactionDate) }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
      return toResponse(updated);
    });
  }

  /**
   * DELETE /transactions/:id（PRD 15.11、16.5、AC-26）。
   * 不存在或屬於他人 404；帳單產生的 409 BILL_LINKED_TRANSACTION（到帳單取消繳費）；
   * 轉出或轉入帳戶停用 409 ACCOUNT_INACTIVE（details 是 []）。
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockOwnTransaction(tx, userId, id);
      await lockAccounts(tx, userId, [row.accountId, row.toAccountId]);
      await this.assertOriginalAccountsActive(tx, userId, row, false);
      await tx.transaction.delete({ where: { id: row.id } });
    });
  }

  /** 鎖住並讀出自己的交易；不存在或屬於他人 404，帳單產生的 409 */
  private async lockOwnTransaction(
    tx: PrismaTx,
    userId: string,
    id: string,
  ): Promise<Transaction> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM transactions
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw new AppException('TRANSACTION_NOT_FOUND');
    const row = await tx.transaction.findUniqueOrThrow({ where: { id } });
    if (row.billId !== null) throw new AppException('BILL_LINKED_TRANSACTION');
    return row;
  }

  /**
   * 原本的轉出、轉入帳戶有停用的就 409 ACCOUNT_INACTIVE。
   * withField：PATCH 時 details 是對應的帳戶欄位；DELETE 時是 []（docs/error-codes.md）。
   */
  private async assertOriginalAccountsActive(
    tx: PrismaTx,
    userId: string,
    row: Transaction,
    withField: boolean,
  ): Promise<void> {
    const ids = row.toAccountId
      ? [row.accountId, row.toAccountId]
      : [row.accountId];
    const inactive = await tx.account.findMany({
      where: { userId, id: { in: ids }, isActive: false },
      select: { id: true },
    });
    if (inactive.length === 0) return;
    if (!withField) throw new AppException('ACCOUNT_INACTIVE');
    const field = inactive.some((a) => a.id === row.accountId)
      ? 'accountId'
      : 'toAccountId';
    throw AppException.forField('ACCOUNT_INACTIVE', field);
  }

  /** 帳戶屬於登入者且啟用中（ACCOUNT_NOT_FOUND 400／ACCOUNT_INACTIVE） */
  private async assertAccountsUsable(
    tx: PrismaTx,
    userId: string,
    f: TransactionFields,
  ): Promise<void> {
    await this.accounts.assertActiveAccount(
      userId,
      f.accountId,
      'accountId',
      tx,
    );
    if (f.toAccountId !== null) {
      await this.accounts.assertActiveAccount(
        userId,
        f.toAccountId,
        'toAccountId',
        tx,
      );
    }
  }

  /** 收入／支出的分類可用且類型相同（CATEGORY_NOT_FOUND／CATEGORY_TYPE_MISMATCH） */
  private async assertCategoryUsable(
    tx: PrismaTx,
    userId: string,
    f: TransactionFields,
  ): Promise<void> {
    if (f.categoryId === null) return;
    const type =
      f.transactionType === TransactionType.income
        ? CategoryType.income
        : CategoryType.expense;
    await this.categories.assertUsable(
      userId,
      f.categoryId,
      type,
      'categoryId',
      tx,
    );
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
        note: data.note,
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

/** 新增與修改共用的欄位檢查對象（修改時是原值＋請求合併後的結果） */
interface TransactionFields {
  transactionType: TransactionType;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
}

/**
 * 類型與欄位是否相符（不查資料庫）：
 * 轉帳要有 toAccountId、不能有 categoryId，且不能轉給同一個帳戶；收入、支出相反。
 */
function assertFieldsMatchType(f: TransactionFields): void {
  if (f.transactionType === TransactionType.transfer) {
    if (f.categoryId !== null) {
      throw AppException.forField('TRANSACTION_FIELDS_MISMATCH', 'categoryId');
    }
    if (f.toAccountId === null) {
      throw AppException.forField('TRANSACTION_FIELDS_MISMATCH', 'toAccountId');
    }
    if (f.toAccountId === f.accountId) {
      throw AppException.forField('TRANSFER_SAME_ACCOUNT', 'toAccountId');
    }
  } else {
    if (f.toAccountId !== null) {
      throw AppException.forField('TRANSACTION_FIELDS_MISMATCH', 'toAccountId');
    }
    if (f.categoryId === null) {
      throw AppException.forField('TRANSACTION_FIELDS_MISMATCH', 'categoryId');
    }
  }
}

/**
 * 鎖住這些帳戶（FOR SHARE）：寫入交易時和停用帳戶（之後的 PATCH /accounts 用 FOR UPDATE）排隊，
 * 避免停用的帳戶又被寫進交易、或停用時餘額不是 0。多筆交易同時寫同一個帳戶不會互相擋。
 * 依 id 排序再鎖，避免兩個請求用相反順序鎖而互相等待。不屬於登入者的 id 不會被鎖，之後的檢查會回 400。
 */
async function lockAccounts(
  tx: PrismaTx,
  userId: string,
  ids: (string | null)[],
): Promise<void> {
  const unique = [
    ...new Set(ids.filter((id): id is string => id !== null)),
  ].sort();
  if (unique.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM accounts
    WHERE user_id = ${userId}::uuid AND id = ANY(${unique}::uuid[])
    ORDER BY id
    FOR SHARE`;
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
