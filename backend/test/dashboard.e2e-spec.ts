import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import {
  CategoryType,
  PrismaService,
  TransactionType,
} from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  createCategory,
  createTransaction,
  createUser,
  resetDb,
} from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

const TODAY = '2026-11-20';

/**
 * Dashboard（最小流程 ④：本月收支正確）。
 * 帳單、貸款（E）、目標（D）還沒實作，所以那些區塊是 null 並列在 unavailable；
 * E、D 實作後，這裡的 unavailable 與 null 的預期要跟著改。
 */
describe('Dashboard API（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let auth: string;

  const summary = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/dashboard/summary${query}`)
      .set('Authorization', auth);

  beforeAll(async () => {
    const clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'c-dashboard@example.com');
    auth = await bearer(app, userId);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  it('沒有任何資料：收支 0、儲蓄率 null、沒有現金帳戶', async () => {
    const res = await summary().expect(200);
    expect(res.body).toEqual({
      today: TODAY,
      month: '2026-11',
      income: '0.00',
      expense: '0.00',
      savingsRate: null,
      accountsTotal: '0.00',
      netWorth: null,
      availableCash: '0.00',
      hasCashAccounts: false,
      billsOverdue: null,
      billsOverdueCount: null,
      billsDueSoon: null,
      fundingGap: null,
      loans: null,
      goal: null,
      nextStep: null,
      unavailable: ['bills', 'loans', 'goal'],
    });
  });

  it('AC-22 驗算：本月收支、儲蓄率、帳戶合計、可用現金（轉帳不計收支）', async () => {
    const bank = await prisma.account.create({
      data: {
        userId,
        name: '銀行',
        accountType: 'bank',
        openingBalance: 300000,
      },
    });
    const card = await prisma.account.create({
      data: {
        userId,
        name: '信用卡',
        accountType: 'credit_card',
        openingBalance: 0,
      },
    });
    const salary = await createCategory(prisma, 'salary', CategoryType.income);
    const living = await createCategory(prisma, 'living', CategoryType.expense);
    const housing = await createCategory(
      prisma,
      'housing',
      CategoryType.expense,
    );
    const base = { userId, transactionDate: '2026-11-05' };
    await createTransaction(prisma, {
      ...base,
      accountId: bank.id,
      transactionType: TransactionType.income,
      amount: '50000',
      categoryId: salary,
    });
    await createTransaction(prisma, {
      ...base,
      accountId: card.id,
      transactionType: TransactionType.expense,
      amount: '30000',
      categoryId: living,
    });
    await createTransaction(prisma, {
      ...base,
      accountId: bank.id,
      transactionType: TransactionType.expense,
      amount: '80000',
      categoryId: housing,
    });
    await createTransaction(prisma, {
      ...base,
      accountId: bank.id,
      transactionType: TransactionType.transfer,
      amount: '10000',
      toAccountId: card.id,
    });

    const res = await summary().expect(200);
    expect(res.body).toMatchObject({
      income: '50000.00',
      expense: '110000.00',
      savingsRate: -120,
      // 銀行 300000 + 50000 − 80000 − 10000 = 260000；信用卡 −30000 + 10000 = −20000
      accountsTotal: '240000.00',
      availableCash: '260000.00',
      hasCashAccounts: true,
    });
  });

  it('只算本月、日期 ≤ 今天的交易：上個月、明天的都不算（AC-19）', async () => {
    const bank = await prisma.account.create({
      data: { userId, name: '銀行', accountType: 'bank', openingBalance: 0 },
    });
    const salary = await createCategory(prisma, 'salary', CategoryType.income);
    const food = await createCategory(prisma, 'food', CategoryType.expense);
    const tx = { userId, accountId: bank.id };
    await createTransaction(prisma, {
      ...tx,
      transactionType: TransactionType.income,
      amount: '1000',
      categoryId: salary,
      transactionDate: '2026-11-01',
    });
    await createTransaction(prisma, {
      ...tx,
      transactionType: TransactionType.expense,
      amount: '200',
      categoryId: food,
      transactionDate: TODAY,
    });
    await createTransaction(prisma, {
      ...tx,
      transactionType: TransactionType.expense,
      amount: '999',
      categoryId: food,
      transactionDate: '2026-10-31',
    });
    await createTransaction(prisma, {
      ...tx,
      transactionType: TransactionType.income,
      amount: '9999',
      categoryId: salary,
      transactionDate: '2026-11-21',
    });

    const res = await summary().expect(200);
    expect(res.body).toMatchObject({
      income: '1000.00',
      expense: '200.00',
      savingsRate: 80,
    });
  });

  it('?month=2026-10 只影響收支；帳戶合計仍用今天', async () => {
    const bank = await prisma.account.create({
      data: { userId, name: '銀行', accountType: 'bank', openingBalance: 5000 },
    });
    const food = await createCategory(prisma, 'food', CategoryType.expense);
    await createTransaction(prisma, {
      userId,
      accountId: bank.id,
      transactionType: TransactionType.expense,
      amount: '999',
      categoryId: food,
      transactionDate: '2026-10-31',
    });

    const res = await summary('?month=2026-10').expect(200);
    expect(res.body).toMatchObject({
      month: '2026-10',
      expense: '999.00',
      accountsTotal: '4001.00',
    });
  });

  it('估計帳戶算進帳戶合計，但不算可用現金；投資、信用卡也不算可用現金', async () => {
    await prisma.account.createMany({
      data: [
        {
          userId,
          name: '現有資產（估計）',
          accountType: 'bank',
          openingBalance: 500000,
          isEstimate: true,
        },
        {
          userId,
          name: '股票',
          accountType: 'investment',
          openingBalance: 100000,
        },
        { userId, name: '錢包', accountType: 'cash', openingBalance: 3000 },
      ],
    });
    const res = await summary().expect(200);
    expect(res.body).toMatchObject({
      accountsTotal: '603000.00',
      availableCash: '3000.00',
      hasCashAccounts: true,
    });
  });

  it('看不到別人的資料', async () => {
    const otherId = await createUser(prisma, 'c-other@example.com');
    await prisma.account.create({
      data: {
        userId: otherId,
        name: 'B',
        accountType: 'bank',
        openingBalance: 99999,
      },
    });
    const res = await summary().expect(200);
    expect(res.body).toMatchObject({
      accountsTotal: '0.00',
      hasCashAccounts: false,
    });
  });

  it.each(['2026-13', '2026-1', 'abc'])(
    '?month=%s 不合法：400 VALIDATION_FAILED',
    async (month) => {
      const res = await summary(`?month=${month}`).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
});
