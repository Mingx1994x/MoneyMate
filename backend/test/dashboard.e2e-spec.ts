import { NotImplementedException, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import {
  BillsService,
  type BillAlertItem,
  type BillAlerts,
} from '../src/modules/bills/index.js';
import { LoansService, type LoanSummary } from '../src/modules/loans/index.js';
import {
  CategoryType,
  Prisma,
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
 * E 的 LoansService、BillsService 換成 vi.fn()，測試結果不受 E 有沒有實作影響，分三組：
 * 1. 丟 NotImplementedException（預設）：分階段交付，區塊是 null 並列進 unavailable
 * 2. 回傳假資料：接上後的淨資產、資金缺口、帳單清單取前 5 筆
 * 3. 丟一般的 Error：整支回 500，不回傳部分數字（PRD 18）
 * 目標（D 的 getGoalProgress）還沒接上，goal 一律在 unavailable。
 */
describe('Dashboard API（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let auth: string;

  const getLoanSummary =
    vi.fn<(userId: string, today: string) => Promise<LoanSummary>>();
  const getBillAlerts =
    vi.fn<(userId: string, today: string) => Promise<BillAlerts>>();
  const fakeLoans: Pick<LoansService, 'getLoanSummary'> = { getLoanSummary };
  const fakeBills: Pick<BillsService, 'getBillAlerts'> = { getBillAlerts };
  const notImplemented = () => Promise.reject(new NotImplementedException());

  const summary = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/dashboard/summary${query}`)
      .set('Authorization', auth);

  beforeAll(async () => {
    const clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) =>
        b
          .overrideProvider(ClockService)
          .useValue(clock)
          .overrideProvider(LoansService)
          .useValue(fakeLoans)
          .overrideProvider(BillsService)
          .useValue(fakeBills),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'c-dashboard@example.com');
    auth = await bearer(app, userId);
    // 預設：E 的 service 還沒實作
    getLoanSummary.mockReset().mockImplementation(notImplemented);
    getBillAlerts.mockReset().mockImplementation(notImplemented);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  it('帳單、貸款還沒實作：沒有任何資料時收支 0、儲蓄率 null，區塊列進 unavailable', async () => {
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
  describe('接上帳單、貸款後（E 的 service 回傳假資料）', () => {
    const D = (v: string | number) => new Prisma.Decimal(v);
    const noLoans: LoanSummary = {
      activeCount: 0,
      outstandingTotal: D(0),
      upcomingPayments: [],
    };
    const noBills: BillAlerts = {
      overdue: [],
      overdueCount: 0,
      dueSoon: [],
      dueSoonCount: 0,
      dueTotal: D(0),
    };
    const bill = (
      n: number,
      amount: string,
      dueDate: string,
      daysUntilDue: number,
    ): BillAlertItem => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      name: `帳單 ${n}`,
      amount: D(amount),
      dueDate,
      accountId: '00000000-0000-4000-8000-0000000000aa',
      daysUntilDue,
    });
    const bank = (openingBalance: number, isEstimate = false) =>
      prisma.account.create({
        data: {
          userId,
          name: isEstimate ? '現有資產（估計）' : '銀行',
          accountType: 'bank',
          openingBalance,
          isEstimate,
        },
      });

    beforeEach(() => {
      getLoanSummary.mockResolvedValue(noLoans);
      getBillAlerts.mockResolvedValue(noBills);
    });

    it('沒有貸款、沒有帳單：是「有資料但是空」，不列進 unavailable', async () => {
      const res = await summary().expect(200);
      expect(res.body).toEqual({
        today: TODAY,
        month: '2026-11',
        income: '0.00',
        expense: '0.00',
        savingsRate: null,
        accountsTotal: '0.00',
        netWorth: '0.00',
        availableCash: '0.00',
        hasCashAccounts: false,
        billsOverdue: [],
        billsOverdueCount: 0,
        billsDueSoon: [],
        fundingGap: null,
        loans: {
          outstandingTotal: '0.00',
          activeCount: 0,
          upcomingPayments: [],
        },
        goal: null,
        // 目標還沒接上，不給可能錯誤的建議
        nextStep: null,
        unavailable: ['goal'],
      });
    });

    it('呼叫 E 的 service 時帶登入者與台北今天', async () => {
      await summary().expect(200);
      expect(getLoanSummary).toHaveBeenCalledWith(userId, TODAY);
      expect(getBillAlerts).toHaveBeenCalledWith(userId, TODAY);
    });

    it('AC-22 淨資產 −760,000：帳戶合計 240,000 − 房貸未償 1,000,000', async () => {
      // 銀行 260,000、信用卡 −20,000（AC-22 交易後的餘額）
      await bank(260000);
      await prisma.account.create({
        data: {
          userId,
          name: '信用卡',
          accountType: 'credit_card',
          openingBalance: -20000,
        },
      });
      getLoanSummary.mockResolvedValue({
        activeCount: 1,
        outstandingTotal: D(1000000),
        upcomingPayments: [
          {
            loanId: '00000000-0000-4000-8000-0000000000bb',
            name: '房貸',
            date: '2026-11-25',
            monthlyPayment: D('17969'),
            daysUntilDue: 5,
          },
        ],
      });

      const res = await summary().expect(200);
      expect(res.body).toMatchObject({
        accountsTotal: '240000.00',
        netWorth: '-760000.00',
        loans: {
          outstandingTotal: '1000000.00',
          activeCount: 1,
          upcomingPayments: [
            {
              loanId: '00000000-0000-4000-8000-0000000000bb',
              name: '房貸',
              date: '2026-11-25',
              monthlyPayment: '17969.00',
            },
          ],
        },
      });
    });

    it('AC-25 資金缺口 ＝ 14 天內待繳合計 − 可用現金；逾期的、估計帳戶都不算', async () => {
      await bank(10000);
      await bank(500000, true); // 估計帳戶不算可用現金
      getBillAlerts.mockResolvedValue({
        overdue: [bill(1, '99999', '2026-11-01', -19)],
        overdueCount: 1,
        dueSoon: [bill(2, '8000', TODAY, 0), bill(3, '7000', '2026-12-04', 14)],
        dueSoonCount: 2,
        dueTotal: D(15000), // E 算好的 dueSoon 合計，逾期的不算
      });

      const res = await summary().expect(200);
      expect(res.body).toMatchObject({
        availableCash: '10000.00',
        fundingGap: '5000.00',
        billsOverdueCount: 1,
      });
    });

    it('可用現金夠付：沒有資金缺口', async () => {
      await bank(20000);
      getBillAlerts.mockResolvedValue({
        ...noBills,
        dueSoon: [bill(1, '15000', TODAY, 0)],
        dueSoonCount: 1,
        dueTotal: D(15000),
      });
      const res = await summary().expect(200);
      expect(res.body).toMatchObject({ fundingGap: null });
    });

    it('沒有現金／銀行帳戶：不算資金缺口（AC-20）', async () => {
      await bank(500000, true); // 只有估計帳戶
      getBillAlerts.mockResolvedValue({
        ...noBills,
        dueSoon: [bill(1, '15000', TODAY, 0)],
        dueSoonCount: 1,
        dueTotal: D(15000),
      });
      const res = await summary().expect(200);
      expect(res.body).toMatchObject({
        hasCashAccounts: false,
        fundingGap: null,
      });
    });

    it('帳單超過 5 筆：清單只回前 5 筆，筆數照實際', async () => {
      const overdue = [1, 2, 3, 4, 5, 6, 7].map((n) =>
        bill(n, '100', '2026-11-01', -19),
      );
      const dueSoon = [11, 12, 13, 14, 15, 16].map((n) =>
        bill(n, '200', '2026-11-25', 5),
      );
      getBillAlerts.mockResolvedValue({
        overdue,
        overdueCount: 7,
        dueSoon,
        dueSoonCount: 6,
        dueTotal: D(1200),
      });

      const res = await summary().expect(200);
      const body = res.body as {
        billsOverdue: { id: string }[];
        billsDueSoon: { id: string }[];
        billsOverdueCount: number;
      };
      expect(body.billsOverdueCount).toBe(7);
      expect(body.billsOverdue.map((b) => b.id)).toEqual(
        overdue.slice(0, 5).map((b) => b.id),
      );
      expect(body.billsDueSoon.map((b) => b.id)).toEqual(
        dueSoon.slice(0, 5).map((b) => b.id),
      );
      // 每筆只回畫面要的欄位，金額轉成字串
      expect(body.billsOverdue[0]).toEqual({
        id: overdue[0].id,
        name: '帳單 1',
        amount: '100.00',
        dueDate: '2026-11-01',
        daysUntilDue: -19,
      });
    });
  });

  describe('E 的 service 出錯（不是 NotImplementedException）', () => {
    it.each([
      ['貸款', () => getLoanSummary],
      ['帳單', () => getBillAlerts],
    ])(
      '%s查詢失敗：整支回 500，不回傳部分數字（PRD 18）',
      async (_name, mock) => {
        getLoanSummary.mockResolvedValue({
          activeCount: 0,
          outstandingTotal: new Prisma.Decimal(0),
          upcomingPayments: [],
        });
        getBillAlerts.mockResolvedValue({
          overdue: [],
          overdueCount: 0,
          dueSoon: [],
          dueSoonCount: 0,
          dueTotal: new Prisma.Decimal(0),
        });
        mock().mockRejectedValue(new Error('資料庫連線中斷'));

        const res = await summary().expect(500);
        expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR' });
        expect(res.body).not.toHaveProperty('income');
        expect(res.body).not.toHaveProperty('unavailable');
      },
    );
  });
});
