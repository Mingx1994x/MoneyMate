import { Injectable } from '@nestjs/common';
import type { DateOnly } from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { toMoney, toMoneyString } from '../../common/money.js';
import {
  AccountType,
  CategoryType,
  Prisma,
  PrismaService,
  type Account,
  type PrismaTx,
} from '../../prisma/index.js';
import { CategoriesService } from '../categories/index.js';
import { FinanceCalcService } from '../finance/index.js';
import type { AccountResponseDto } from './dto/account-response.dto.js';
import type { CreateAccountDto } from './dto/create-account.dto.js';

/** createAccount 的輸入（給 D 的問卷與 POST /accounts 共用） */
export interface CreateAccountData {
  name: string;
  accountType: AccountType;
  openingBalance: Prisma.Decimal;
  /** 預設 false；問卷建立「現有資產（估計）」時傳 true */
  isEstimate?: boolean;
  note?: string | null;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceCalcService,
    private readonly categories: CategoriesService,
  ) {}

  /**
   * body 引用的帳戶可以寫入：屬於這位使用者（否則 400 ACCOUNT_NOT_FOUND），而且啟用中（否則 409 ACCOUNT_INACTIVE）。
   * field 是錯誤 details 的欄位名稱（accountId、toAccountId）。給 transactions 與 E 的帳單用。
   */
  async assertActiveAccount(
    userId: string,
    accountId: string,
    field = 'accountId',
    db: PrismaTx = this.prisma,
  ): Promise<void> {
    const account = await db.account.findFirst({
      where: { id: accountId, userId },
      select: { isActive: true },
    });
    if (!account) throw AppException.forField('ACCOUNT_NOT_FOUND', field, 400);
    if (!account.isActive)
      throw AppException.forField('ACCOUNT_INACTIVE', field);
  }

  /**
   * 給 E 的帳單（PRD 16.7）：依序檢查帳戶屬於登入者、帳戶啟用中（requireActiveAccount 預設 true）、
   * 分類可用、分類類型相同；第一個失敗就丟出。
   */
  async assertAccountAndCategoryOwned(
    userId: string,
    accountId: string,
    categoryId: string,
    options: { categoryType: CategoryType; requireActiveAccount?: boolean },
    db: PrismaTx = this.prisma,
  ): Promise<void> {
    if (options.requireActiveAccount ?? true) {
      await this.assertActiveAccount(userId, accountId, 'accountId', db);
    } else {
      const owned = await db.account.findFirst({
        where: { id: accountId, userId },
        select: { id: true },
      });
      if (!owned) {
        throw AppException.forField('ACCOUNT_NOT_FOUND', 'accountId', 400);
      }
    }
    await this.categories.assertUsable(
      userId,
      categoryId,
      options.categoryType,
      'categoryId',
      db,
    );
  }

  /** GET /accounts：預設只列啟用中的帳戶；啟用中在前，同組依 createdAt 由舊到新，再依 id */
  async findAll(
    userId: string,
    today: DateOnly,
    includeInactive: boolean,
  ): Promise<AccountResponseDto[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const [balances, used] = await Promise.all([
      this.balanceMap(userId, today),
      this.accountsWithTransactions(userId),
    ]);
    return accounts.map((a) =>
      toResponse(a, balances.get(a.id) ?? a.openingBalance, used.has(a.id)),
    );
  }

  /** GET /accounts/:id：停用的也查得到；不存在或屬於他人回 404 */
  async findOne(
    userId: string,
    id: string,
    today: DateOnly,
  ): Promise<AccountResponseDto> {
    const account = await this.prisma.account.findFirst({
      where: { id, userId },
    });
    if (!account) throw new AppException('ACCOUNT_NOT_FOUND');
    const [balances, used] = await Promise.all([
      this.balanceMap(userId, today),
      this.accountsWithTransactions(userId, id),
    ]);
    return toResponse(
      account,
      balances.get(id) ?? account.openingBalance,
      used.has(id),
    );
  }

  /**
   * POST /accounts。deductFromEstimate 時，同一個資料庫交易內從估計帳戶扣掉
   * min(初始餘額, 估計帳戶目前餘額)（PRD 15.9）；這個金額 ≤ 0 時不扣、存 null。
   */
  async create(
    userId: string,
    dto: CreateAccountDto,
    today: DateOnly,
  ): Promise<AccountResponseDto> {
    const openingBalance = toMoney(dto.openingBalance);
    const account = await this.prisma.$transaction(async (tx) => {
      const deducted =
        dto.deductFromEstimate && openingBalance.gt(0)
          ? await this.deductFromEstimate(tx, userId, openingBalance, today)
          : null;
      return this.insertAccount(tx, userId, {
        name: dto.name,
        accountType: dto.accountType,
        openingBalance,
        note: dto.note ?? null,
        deductedFromEstimate: deducted,
      });
    });
    // 剛建立的帳戶沒有交易，目前餘額＝初始餘額
    return toResponse(account, account.openingBalance, false);
  }

  /**
   * 給 D 的問卷建立估計帳戶（PRD 16.7，11/08 前）。不做估計值扣除，deductedFromEstimate 一律 null。
   * - isEstimate 時 accountType 必須是 bank；每位使用者最多 1 個估計帳戶（重複時 CONFLICT）。
   * - 初始餘額只有 credit_card 與估計帳戶可以是負數，其他回 OPENING_BALANCE_NEGATIVE。
   */
  createAccount(
    tx: PrismaTx,
    userId: string,
    data: CreateAccountData,
  ): Promise<Account> {
    return this.insertAccount(tx, userId, {
      ...data,
      deductedFromEstimate: null,
    });
  }

  private async insertAccount(
    tx: PrismaTx,
    userId: string,
    data: CreateAccountData & { deductedFromEstimate: Prisma.Decimal | null },
  ): Promise<Account> {
    const isEstimate = data.isEstimate ?? false;
    if (isEstimate && data.accountType !== AccountType.bank) {
      // 呼叫端寫錯（資料庫的 accounts_estimate_is_bank_check 也會擋），不是使用者能造成的
      throw new Error('createAccount: 估計帳戶的類型必須是 bank');
    }
    if (
      !isEstimate &&
      data.accountType !== AccountType.credit_card &&
      data.openingBalance.lt(0)
    ) {
      throw AppException.forField('OPENING_BALANCE_NEGATIVE', 'openingBalance');
    }
    if (isEstimate) {
      const existing = await tx.account.findFirst({
        where: { userId, isEstimate: true },
        select: { id: true },
      });
      // 部分唯一索引 accounts_one_estimate_per_user 是最後一道防線
      if (existing) throw new AppException('CONFLICT');
    }
    return tx.account.create({
      data: {
        userId,
        name: data.name,
        accountType: data.accountType,
        openingBalance: data.openingBalance,
        isEstimate,
        deductedFromEstimate: data.deductedFromEstimate,
        note: data.note ?? null,
      },
    });
  }

  /**
   * 從啟用中的估計帳戶扣掉 min(amount, 估計帳戶目前餘額)，回傳實際扣除金額；
   * 沒有估計帳戶、已停用，或扣除金額 ≤ 0 時回 null（不扣、不報錯）。
   * 先 FOR UPDATE 鎖住估計帳戶，同時新增兩個帳戶也不會重複扣。扣到 0 時自動停用。
   */
  private async deductFromEstimate(
    tx: PrismaTx,
    userId: string,
    amount: Prisma.Decimal,
    today: DateOnly,
  ): Promise<Prisma.Decimal | null> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM accounts
      WHERE user_id = ${userId}::uuid AND is_estimate AND is_active
      FOR UPDATE`;
    const estimateId = locked[0]?.id;
    if (!estimateId) return null;

    const current = await this.finance.getAccountBalance(
      userId,
      estimateId,
      today,
      tx,
    );
    if (!current) return null;
    const deducted = Prisma.Decimal.min(amount, current);
    if (deducted.lte(0)) return null;

    await tx.account.update({
      where: { id: estimateId },
      data: {
        openingBalance: { decrement: deducted },
        isActive: current.minus(deducted).gt(0),
      },
    });
    return deducted;
  }

  private async balanceMap(
    userId: string,
    today: DateOnly,
  ): Promise<Map<string, Prisma.Decimal>> {
    const balances = await this.finance.getAccountBalances(userId, today);
    return new Map(balances.map((b) => [b.id, b.balance]));
  }

  /** 有任何交易（轉出或轉入，含未來日期）的帳戶 id；帶 accountId 時只查那一個 */
  private async accountsWithTransactions(
    userId: string,
    accountId?: string,
  ): Promise<Set<string>> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(accountId
          ? { OR: [{ accountId }, { toAccountId: accountId }] }
          : {}),
      },
      select: { accountId: true, toAccountId: true },
      distinct: ['accountId', 'toAccountId'],
    });
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.accountId);
      if (r.toAccountId) ids.add(r.toAccountId);
    }
    return ids;
  }
}

function toResponse(
  a: Account,
  currentBalance: Prisma.Decimal,
  hasTransactions: boolean,
): AccountResponseDto {
  return {
    id: a.id,
    name: a.name,
    accountType: a.accountType,
    currency: a.currency,
    openingBalance: toMoneyString(a.openingBalance),
    currentBalance: toMoneyString(currentBalance),
    isActive: a.isActive,
    isEstimate: a.isEstimate,
    deductedFromEstimate:
      a.deductedFromEstimate === null
        ? null
        : toMoneyString(a.deductedFromEstimate),
    hasTransactions,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
