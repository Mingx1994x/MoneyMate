import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';

/**
 * 資料庫約束（migration 20261027034404_init 手動加的 CHECK、部分唯一索引，以及複合外鍵）。
 * 這些規則是 service 檢查之外的最後一道防線，所以直接用 SQL 寫入，不經過 API。
 * 規則清單見 docs/data-dictionary.md「手動加在 migration 的規則」；改規則時要同步改這裡。
 */
describe('資料庫約束（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // 每個測試前重建的資料
  let userA: string;
  let userB: string;
  let accountA: string;
  let accountB: string;
  let categoryId: string;

  /** 執行一段 SQL，預期被指定的約束擋下 */
  async function expectRejected(
    sql: string,
    constraint: string,
  ): Promise<void> {
    await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow(constraint);
  }

  async function oneId(sql: string): Promise<string> {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(sql);
    return rows[0].id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    // 刪使用者會 Cascade 刪掉他的帳戶、交易、帳單、貸款、目標
    await prisma.$executeRawUnsafe('TRUNCATE users, categories CASCADE');
    userA = await oneId(
      `INSERT INTO users (email, password_hash) VALUES ('a@test.local', 'x') RETURNING id`,
    );
    userB = await oneId(
      `INSERT INTO users (email, password_hash) VALUES ('b@test.local', 'x') RETURNING id`,
    );
    accountA = await oneId(
      `INSERT INTO accounts (user_id, name, account_type, opening_balance)
       VALUES ('${userA}', 'A 銀行', 'bank', 1000) RETURNING id`,
    );
    accountB = await oneId(
      `INSERT INTO accounts (user_id, name, account_type, opening_balance)
       VALUES ('${userB}', 'B 銀行', 'bank', 1000) RETURNING id`,
    );
    categoryId = await oneId(
      `INSERT INTO categories (code, name, type) VALUES ('food', '飲食', 'expense') RETURNING id`,
    );
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe('TRUNCATE users, categories CASCADE');
    await app?.close();
  });

  describe('複合外鍵：交易、帳單只能用同一個使用者的帳戶', () => {
    it('用自己的帳戶記帳可以', async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO transactions (user_id, account_id, transaction_type, amount, category_id, transaction_date)
         VALUES ('${userA}', '${accountA}', 'expense', 100, '${categoryId}', '2026-10-01')`,
      );
    });

    it('用別人的帳戶記帳被擋下', async () => {
      await expectRejected(
        `INSERT INTO transactions (user_id, account_id, transaction_type, amount, category_id, transaction_date)
         VALUES ('${userA}', '${accountB}', 'expense', 100, '${categoryId}', '2026-10-01')`,
        'transactions_account_id_user_id_fkey',
      );
    });

    it('轉帳到別人的帳戶被擋下', async () => {
      await expectRejected(
        `INSERT INTO transactions (user_id, account_id, to_account_id, transaction_type, amount, transaction_date)
         VALUES ('${userA}', '${accountA}', '${accountB}', 'transfer', 50, '2026-10-01')`,
        'transactions_to_account_id_user_id_fkey',
      );
    });

    it('帳單用別人的帳戶被擋下', async () => {
      await expectRejected(
        `INSERT INTO bills (user_id, name, amount, category_id, account_id, due_date, due_day)
         VALUES ('${userA}', '電話費', 599, '${categoryId}', '${accountB}', '2026-10-01', 1)`,
        'bills_account_id_user_id_fkey',
      );
    });

    it('有交易的帳戶不能改成別人的（onUpdate Restrict）', async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO transactions (user_id, account_id, transaction_type, amount, category_id, transaction_date)
         VALUES ('${userA}', '${accountA}', 'expense', 100, '${categoryId}', '2026-10-01')`,
      );
      await expectRejected(
        `UPDATE accounts SET user_id = '${userB}' WHERE id = '${accountA}'`,
        'transactions_account_id_user_id_fkey',
      );
    });
  });

  describe('accounts', () => {
    it('估計帳戶的初始餘額可以是負數', async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO accounts (user_id, name, account_type, opening_balance, is_estimate)
         VALUES ('${userA}', '現有資產（估計）', 'bank', -50, true)`,
      );
    });

    it('一般銀行帳戶的初始餘額是負數被擋下', async () => {
      await expectRejected(
        `INSERT INTO accounts (user_id, name, account_type, opening_balance)
         VALUES ('${userA}', '負數', 'bank', -1)`,
        'accounts_opening_balance_check',
      );
    });

    it('信用卡的初始餘額可以是負數', async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO accounts (user_id, name, account_type, opening_balance)
         VALUES ('${userA}', '信用卡', 'credit_card', -3000)`,
      );
    });

    it('估計帳戶不是 bank 被擋下', async () => {
      await expectRejected(
        `INSERT INTO accounts (user_id, name, account_type, opening_balance, is_estimate)
         VALUES ('${userA}', '估計', 'investment', 100, true)`,
        'accounts_estimate_is_bank_check',
      );
    });

    it('每位使用者最多 1 個估計帳戶', async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO accounts (user_id, name, account_type, opening_balance, is_estimate)
         VALUES ('${userA}', '估計 1', 'bank', 100, true)`,
      );
      await expectRejected(
        `INSERT INTO accounts (user_id, name, account_type, opening_balance, is_estimate)
         VALUES ('${userA}', '估計 2', 'bank', 100, true)`,
        'accounts_one_estimate_per_user',
      );
    });

    it('deducted_from_estimate 存 0 被擋下（沒扣要存 null）', async () => {
      await expectRejected(
        `INSERT INTO accounts (user_id, name, account_type, opening_balance, deducted_from_estimate)
         VALUES ('${userA}', '台新', 'bank', 100, 0)`,
        'accounts_deducted_from_estimate_check',
      );
    });

    it('幣別不是 TWD 被擋下', async () => {
      await expectRejected(
        `INSERT INTO accounts (user_id, name, account_type, opening_balance, currency)
         VALUES ('${userA}', '美金', 'bank', 100, 'USD')`,
        'accounts_currency_check',
      );
    });
  });

  describe('transactions', () => {
    it('金額是 0 被擋下', async () => {
      await expectRejected(
        `INSERT INTO transactions (user_id, account_id, transaction_type, amount, category_id, transaction_date)
         VALUES ('${userA}', '${accountA}', 'expense', 0, '${categoryId}', '2026-10-01')`,
        'transactions_amount_check',
      );
    });

    it('支出沒有分類被擋下', async () => {
      await expectRejected(
        `INSERT INTO transactions (user_id, account_id, transaction_type, amount, transaction_date)
         VALUES ('${userA}', '${accountA}', 'expense', 100, '2026-10-01')`,
        'transactions_type_fields_check',
      );
    });
  });

  describe('bills', () => {
    const insertBill = (cols: string, vals: string): string =>
      `INSERT INTO bills (user_id, name, amount, category_id, account_id, due_date, due_day, ${cols})
       VALUES ('${userA}', '帳單', 10, '${categoryId}', '${accountA}', '2026-10-01', 1, ${vals})`;

    it('due_month 是 13 被擋下', async () => {
      await expectRejected(
        insertBill('due_month, recurrence', `13, 'yearly'`),
        'bills_values_check',
      );
    });

    it('每年帳單沒有 due_month 被擋下', async () => {
      await expectRejected(
        insertBill('recurrence', `'yearly'`),
        'bills_values_check',
      );
    });

    it('停止重複後 none 仍可保留 due_month', async () => {
      await prisma.$executeRawUnsafe(
        insertBill('due_month, recurrence', `2, 'none'`),
      );
    });

    it('已繳卻沒有實繳金額被擋下', async () => {
      await expectRejected(
        insertBill('status, paid_date', `'paid', '2026-10-01'`),
        'bills_paid_fields_check',
      );
    });

    it('同一系列最多 1 張待繳', async () => {
      const seriesId = '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10';
      await prisma.$executeRawUnsafe(insertBill('series_id', `'${seriesId}'`));
      await expectRejected(
        insertBill('series_id', `'${seriesId}'`),
        'bills_one_pending_per_series',
      );
    });
  });

  describe('loans、users、goals', () => {
    it('貸款繳款日是 32 被擋下', async () => {
      await expectRejected(
        `INSERT INTO loans (user_id, name, loan_type, outstanding_balance, monthly_payment, payment_day, end_date)
         VALUES ('${userA}', '房貸', '房貸', 1000000, 17969, 32, '2031-10-01')`,
        'loans_values_check',
      );
    });

    it('Email 有大寫被擋下', async () => {
      await expectRejected(
        `INSERT INTO users (email, password_hash) VALUES ('C@test.local', 'x')`,
        'users_email_lower_check',
      );
    });

    it('每月花費不是整數被擋下', async () => {
      await expectRejected(
        `INSERT INTO goals (user_id, monthly_spending, target_amount)
         VALUES ('${userB}', 40000.5, 12000150)`,
        'goals_monthly_spending_check',
      );
    });

    it('目標金額不是每月花費 × 300 被擋下', async () => {
      await expectRejected(
        `INSERT INTO goals (user_id, monthly_spending, target_amount)
         VALUES ('${userB}', 40000, 9000000)`,
        'goals_target_amount_check',
      );
    });

    it('每月花費 40000、目標 12,000,000 可以', async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO goals (user_id, monthly_spending, target_amount)
         VALUES ('${userB}', 40000, 12000000)`,
      );
    });
  });

  it('刪除使用者，他的帳戶、交易、帳單一起刪除', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO transactions (user_id, account_id, transaction_type, amount, category_id, transaction_date)
       VALUES ('${userA}', '${accountA}', 'expense', 100, '${categoryId}', '2026-10-01')`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${userA}'`);
    const [counts] = await prisma.$queryRawUnsafe<
      { accounts: bigint; transactions: bigint }[]
    >(
      `SELECT (SELECT count(*) FROM accounts WHERE user_id = '${userA}') AS accounts,
              (SELECT count(*) FROM transactions) AS transactions`,
    );
    expect(counts).toEqual({ accounts: 0n, transactions: 0n });
  });
});
