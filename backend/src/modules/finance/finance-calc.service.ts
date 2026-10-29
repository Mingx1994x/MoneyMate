import { Injectable } from '@nestjs/common';
import { toDbDate, type DateOnly } from '../../common/date-only.js';
import {
  AccountType,
  Prisma,
  PrismaService,
  type PrismaTx,
} from '../../prisma/index.js';

/** 一個帳戶的目前餘額，以及計算帳戶合計、可用現金時需要的屬性 */
export interface AccountBalance {
  id: string;
  accountType: AccountType;
  isActive: boolean;
  isEstimate: boolean;
  /** 目前餘額：初始餘額＋收入−支出＋轉入−轉出，只計入日期 ≤ today 的交易 */
  balance: Prisma.Decimal;
}

/**
 * PRD 15.1 的唯一計算服務（C）。餘額、合計、淨資產、可用現金、月收支一律從這裡算，
 * 其他模組（goals、dashboard、bills）不得自己寫公式。
 * - 只計入 transactionDate ≤ today 的交易；today 由呼叫端用 ClockService 取得。
 * - 讀取方法最後一個參數是 db，在交易內呼叫時傳 tx。
 */
@Injectable()
export class FinanceCalcService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 這位使用者每個帳戶（含停用）的目前餘額。一個 SQL 算完：每筆交易對帳戶的影響
   * 收入 +、支出 −、轉出 −、轉入 +，加總後再加上初始餘額。依 createdAt、id 排序。
   */
  async getAccountBalances(
    userId: string,
    today: DateOnly,
    db: PrismaTx = this.prisma,
  ): Promise<AccountBalance[]> {
    const rows = await db.$queryRaw<
      {
        id: string;
        account_type: AccountType;
        is_active: boolean;
        is_estimate: boolean;
        balance: Prisma.Decimal;
      }[]
    >`
      SELECT a.id, a.account_type, a.is_active, a.is_estimate,
        a.opening_balance + COALESCE(SUM(
          CASE
            WHEN t.to_account_id = a.id THEN t.amount
            WHEN t.transaction_type = 'income' THEN t.amount
            ELSE -t.amount
          END
        ), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON (t.account_id = a.id OR t.to_account_id = a.id)
        AND t.transaction_date <= ${toDbDate(today)}::date
      WHERE a.user_id = ${userId}::uuid
      GROUP BY a.id
      ORDER BY a.created_at, a.id`;
    return rows.map((r) => ({
      id: r.id,
      accountType: r.account_type,
      isActive: r.is_active,
      isEstimate: r.is_estimate,
      balance: new Prisma.Decimal(r.balance),
    }));
  }

  /** 單一帳戶的目前餘額；帳戶不存在或不屬於這位使用者時回 null */
  async getAccountBalance(
    userId: string,
    accountId: string,
    today: DateOnly,
    db: PrismaTx = this.prisma,
  ): Promise<Prisma.Decimal | null> {
    const all = await this.getAccountBalances(userId, today, db);
    return all.find((a) => a.id === accountId)?.balance ?? null;
  }

  /**
   * 帳戶合計（PRD 15.1）：啟用帳戶目前餘額加總，含信用卡負值、投資、估計帳戶。
   * 目標進度、財富自由年齡的「目前金額」都用這個（D）。
   */
  async getAccountsTotal(
    userId: string,
    today: DateOnly,
    db: PrismaTx = this.prisma,
  ): Promise<Prisma.Decimal> {
    const all = await this.getAccountBalances(userId, today, db);
    return all
      .filter((a) => a.isActive)
      .reduce((sum, a) => sum.plus(a.balance), new Prisma.Decimal(0));
  }
}
