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

type TrendMonth = {
  month: string;
  incomeTotal: string;
  expenseTotal: string;
};
const itemsOf = (res: { body: unknown }) =>
  (res.body as { items: TrendMonth[] }).items;

/**
 * 月收支趨勢圖（D-A-005、US-14）：GET /dashboard/trend?months=N
 * - 最近 N 個完整月，不含台北本月，由舊到新；沒有交易的月也回傳 0
 * - 規則與 summary 的本月收支相同（PRD 15.2）：不含轉帳，停用帳戶的交易也算
 */
describe('Dashboard 月收支趨勢（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = FakeClock.onTaipeiDate(TODAY);
  let userId: string;
  let auth: string;
  let bankId: string;
  let salaryId: string;
  let foodId: string;

  const api = () => request(app.getHttpServer());
  const trend = (query = '') =>
    api().get(`/api/v1/dashboard/trend${query}`).set('Authorization', auth);

  const income = (amount: string, date: string, accountId = bankId) =>
    createTransaction(prisma, {
      userId,
      accountId,
      transactionType: TransactionType.income,
      amount,
      transactionDate: date,
      categoryId: salaryId,
    });
  const expense = (amount: string, date: string, accountId = bankId) =>
    createTransaction(prisma, {
      userId,
      accountId,
      transactionType: TransactionType.expense,
      amount,
      transactionDate: date,
      categoryId: foodId,
    });

  const zero = (month: string) => ({
    month,
    incomeTotal: '0.00',
    expenseTotal: '0.00',
  });

  beforeAll(async () => {
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    clock.setTaipeiDate(TODAY);
    await resetDb(prisma);
    userId = await createUser(prisma, 'c-trend@example.com');
    auth = await bearer(app, userId);
    const bank = await prisma.account.create({
      data: { userId, name: '銀行', accountType: 'bank', openingBalance: 0 },
    });
    bankId = bank.id;
    salaryId = await createCategory(prisma, 'salary', CategoryType.income);
    foodId = await createCategory(prisma, 'food', CategoryType.expense);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  it('沒有交易：預設 6 個完整月（2026-05～2026-10），收支都是 0', async () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const res = await trend().expect(200);
    // 不分頁的列表也包一層 items（README「回應格式」）
    expect(res.body).toEqual({
      items: [...months, '2026-10'].map(zero),
    });
  });

  it('依月份加總收入、支出；月初、月底都算進該月；範圍外與本月不算', async () => {
    await income('50000', '2026-05-01'); // 範圍內第一天
    await expense('1200.50', '2026-05-31');
    await income('52000', '2026-10-05');
    await expense('300', '2026-10-31'); // 範圍內最後一天
    await expense('999', '2026-10-15');
    await income('88888', '2026-04-30'); // 範圍前一天：不算
    await expense('777', '2026-11-01'); // 本月：不算
    await income('66666', '2026-12-25'); // 未來：不算

    const res = await trend().expect(200);
    expect(itemsOf(res)).toEqual([
      { month: '2026-05', incomeTotal: '50000.00', expenseTotal: '1200.50' },
      zero('2026-06'),
      zero('2026-07'),
      zero('2026-08'),
      zero('2026-09'),
      { month: '2026-10', incomeTotal: '52000.00', expenseTotal: '1299.00' },
    ]);
  });

  it('轉帳（含繳卡費）不算收支；停用帳戶的交易照算；別人的交易不算', async () => {
    const card = await prisma.account.create({
      data: {
        userId,
        name: '信用卡',
        accountType: 'credit_card',
        openingBalance: 0,
      },
    });
    const closed = await prisma.account.create({
      data: {
        userId,
        name: '舊帳戶',
        accountType: 'cash',
        openingBalance: 0,
      },
    });
    await expense('3000', '2026-10-10', card.id);
    await createTransaction(prisma, {
      userId,
      accountId: bankId,
      toAccountId: card.id,
      transactionType: TransactionType.transfer,
      amount: '3000',
      transactionDate: '2026-10-20',
    });
    await income('500', '2026-10-03', closed.id);
    await expense('500', '2026-10-04', closed.id);
    await prisma.account.update({
      where: { id: closed.id },
      data: { isActive: false },
    });

    const otherId = await createUser(prisma, 'c-trend-other@example.com');
    const otherBank = await prisma.account.create({
      data: {
        userId: otherId,
        name: '別人的銀行',
        accountType: 'bank',
        openingBalance: 0,
      },
    });
    await createTransaction(prisma, {
      userId: otherId,
      accountId: otherBank.id,
      transactionType: TransactionType.income,
      amount: '99999',
      transactionDate: '2026-10-01',
      categoryId: salaryId,
    });

    const res = await trend('?months=1').expect(200);
    expect(itemsOf(res)).toEqual([
      { month: '2026-10', incomeTotal: '500.00', expenseTotal: '3500.00' },
    ]);
  });

  it('和 summary 的該月收支一致', async () => {
    await income('41000', '2026-09-05');
    await expense('12345.67', '2026-09-18');

    const t = await trend('?months=2').expect(200);
    const s = await api()
      .get('/api/v1/dashboard/summary?month=2026-09')
      .set('Authorization', auth)
      .expect(200);
    const [september] = itemsOf(t);
    const totals = s.body as { income: string; expense: string };
    expect(september).toEqual({
      month: '2026-09',
      incomeTotal: totals.income,
      expenseTotal: totals.expense,
    });
    expect(september?.incomeTotal).toBe('41000.00');
    expect(september?.expenseTotal).toBe('12345.67');
  });

  it('months=12：跨年（2025-11～2026-10），共 12 個月', async () => {
    await income('1000', '2025-11-15');
    await expense('200', '2025-12-31');
    await income('3000', '2026-01-01');

    const res = await trend('?months=12').expect(200);
    const body = itemsOf(res);
    expect(body).toHaveLength(12);
    expect(body.map((m) => m.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(body.slice(0, 3)).toEqual([
      { month: '2025-11', incomeTotal: '1000.00', expenseTotal: '0.00' },
      { month: '2025-12', incomeTotal: '0.00', expenseTotal: '200.00' },
      { month: '2026-01', incomeTotal: '3000.00', expenseTotal: '0.00' },
    ]);
  });

  it('台北時間跨月：UTC 還是 11/30、台北已經 12/1，11 月就算完整月', async () => {
    await income('2000', '2026-11-30');
    await expense('100', '2026-12-01'); // 台北今天（本月）：不算
    clock.set('2026-11-30T16:30:00Z'); // 台北 2026-12-01 00:30

    const res = await trend('?months=2').expect(200);
    expect(itemsOf(res)).toEqual([
      zero('2026-10'),
      { month: '2026-11', incomeTotal: '2000.00', expenseTotal: '0.00' },
    ]);
  });

  it('小數金額精確加總（0.1 + 0.2 = 0.30）', async () => {
    await expense('0.1', '2026-10-01');
    await expense('0.2', '2026-10-02');
    await income('0.05', '2026-10-03');

    const res = await trend('?months=1').expect(200);
    expect(itemsOf(res)).toEqual([
      { month: '2026-10', incomeTotal: '0.05', expenseTotal: '0.30' },
    ]);
  });

  it('months 帶兩次：400 VALIDATION_FAILED', async () => {
    const res = await trend('?months=3&months=4').expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.each(['0', '13', '1.5', '-1', 'abc', ''])(
    '?months=%s 不合法：400 VALIDATION_FAILED',
    async (months) => {
      const res = await trend(`?months=${months}`).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );

  it('沒登入：401', async () => {
    await api().get('/api/v1/dashboard/trend').expect(401);
  });
});
