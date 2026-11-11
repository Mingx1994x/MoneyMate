import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService, toTaipeiDate } from '../src/clock/clock.service.js';
import { fromDbDate } from '../src/common/date-only.js';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service.js';
import {
  AccountType,
  LoanStatus,
  PrismaService,
  TransactionType,
} from '../src/prisma/index.js';
import { DEMO_EMAIL, DEMO_NEW_EMAIL, seedDemo } from '../src/seed/demo-data.js';
import { createTestApp } from './utils/create-test-app.js';
import { createUser, resetDb } from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';

/** 台北的今天：最近 12 個完整月是 2025-11 ～ 2026-10，本月記到 11/11 */
const TODAY = '2026-11-11';
const PASSWORD = 'demo-password-123';

describe('seed:demo 重建 Demo 帳號（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FakeClock;

  const api = () => request(app.getHttpServer());
  const run = (password = PASSWORD) => seedDemo(app, password);
  const userOf = (email: string) =>
    prisma.user.findUniqueOrThrow({ where: { email } });
  const login = async (email: string): Promise<string> => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return `Bearer ${(res.body as { accessToken: string }).accessToken}`;
  };

  beforeAll(async () => {
    clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    clock.setTaipeiDate(TODAY);
    await resetDb(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  describe('Demo 帳號', () => {
    it('可以用環境變數的密碼登入，已完成問卷（每月 4 萬 → 目標 1,200 萬）', async () => {
      await run();

      const res = await api()
        .post('/api/v1/auth/login')
        .send({ email: DEMO_EMAIL, password: PASSWORD })
        .expect(200);
      expect(res.body).toMatchObject({
        user: { email: DEMO_EMAIL, hasCompletedOnboarding: true },
      });

      const { id } = await userOf(DEMO_EMAIL);
      const goal = await prisma.goal.findUniqueOrThrow({
        where: { userId: id },
      });
      expect(goal.monthlySpending.toFixed(2)).toBe('40000.00');
      expect(goal.targetAmount.toFixed(2)).toBe('12000000.00');
    });

    it('4 個帳戶：現金、銀行、投資、信用卡，沒有估計帳戶（D-D-004）', async () => {
      await run();
      const { id } = await userOf(DEMO_EMAIL);

      const accounts = await prisma.account.findMany({
        where: { userId: id },
      });
      expect(accounts.map((a) => a.accountType).sort()).toEqual(
        [
          AccountType.bank,
          AccountType.cash,
          AccountType.credit_card,
          AccountType.investment,
        ].sort(),
      );
      expect(accounts.every((a) => a.isActive && !a.isEstimate)).toBe(true);
    });

    it('最近 12 個完整月＋本月到今天的交易：有收入、支出、轉帳（含繳卡費），沒有未來的交易', async () => {
      await run();
      const { id } = await userOf(DEMO_EMAIL);

      const rows = await prisma.transaction.findMany({
        where: { userId: id },
        include: { toAccount: true },
      });
      const dates = rows.map((t) => fromDbDate(t.transactionDate)).sort();
      expect(dates[0].slice(0, 7)).toBe('2025-11');
      expect(dates[dates.length - 1] <= TODAY).toBe(true);

      const months = new Set(dates.map((d) => d.slice(0, 7)));
      expect(months.size).toBe(13);

      const types = new Set(rows.map((t) => t.transactionType));
      expect(types).toEqual(
        new Set([
          TransactionType.income,
          TransactionType.expense,
          TransactionType.transfer,
        ]),
      );
      expect(
        rows.some(
          (t) =>
            t.transactionType === TransactionType.transfer &&
            t.toAccount?.accountType === AccountType.credit_card,
        ),
      ).toBe(true);
    });

    it('1 筆房貸，未償餘額是 60 天前更新的（觸發提醒）', async () => {
      await run();
      const { id } = await userOf(DEMO_EMAIL);

      const loans = await prisma.loan.findMany({ where: { userId: id } });
      expect(loans).toHaveLength(1);
      expect(loans[0]).toMatchObject({
        loanType: 'mortgage',
        status: LoanStatus.active,
      });
      expect(toTaipeiDate(loans[0].balanceUpdatedAt)).toBe('2026-09-12');
    });

    it('每個完整月都有收入和支出，而且有存到錢（目標頁的年儲蓄會用實際記帳）；有出生年', async () => {
      await run();
      const { id } = await userOf(DEMO_EMAIL);

      const rows = await prisma.transaction.findMany({ where: { userId: id } });
      const byMonth = new Map<string, { income: number; expense: number }>();
      for (const t of rows) {
        const month = fromDbDate(t.transactionDate).slice(0, 7);
        const m = byMonth.get(month) ?? { income: 0, expense: 0 };
        if (t.transactionType === TransactionType.income)
          m.income += t.amount.toNumber();
        if (t.transactionType === TransactionType.expense)
          m.expense += t.amount.toNumber();
        byMonth.set(month, m);
      }
      byMonth.delete('2026-11');
      expect(byMonth.size).toBe(12);
      for (const m of byMonth.values()) {
        expect(m.income).toBeGreaterThan(m.expense);
        expect(m.expense).toBeGreaterThan(0);
      }

      const goal = await prisma.goal.findUniqueOrThrow({
        where: { userId: id },
      });
      expect(goal.birthYear).not.toBeNull();
    });

    it('Dashboard 打得開（200）', async () => {
      await run();
      const auth = await login(DEMO_EMAIL);
      await api()
        .get('/api/v1/dashboard/summary')
        .set('Authorization', auth)
        .expect(200);
    });
  });

  describe('「新帳號」：現場示範 30 秒問卷', () => {
    it('可以登入，還沒完成問卷，沒有任何資料', async () => {
      await run();

      const res = await api()
        .post('/api/v1/auth/login')
        .send({ email: DEMO_NEW_EMAIL, password: PASSWORD })
        .expect(200);
      expect(res.body).toMatchObject({
        user: { email: DEMO_NEW_EMAIL, hasCompletedOnboarding: false },
      });

      const { id } = await userOf(DEMO_NEW_EMAIL);
      expect(await prisma.goal.count({ where: { userId: id } })).toBe(0);
      expect(await prisma.account.count({ where: { userId: id } })).toBe(0);
    });

    it('示範過問卷後重跑 seed → 又回到還沒做問卷', async () => {
      await run();
      const before = await userOf(DEMO_NEW_EMAIL);
      await app
        .get(OnboardingService)
        .submit(before.id, { monthlySpending: 30000 });

      await run();
      const { id } = await userOf(DEMO_NEW_EMAIL);
      expect(await prisma.goal.count({ where: { userId: id } })).toBe(0);
    });
  });

  describe('可以重複執行、只動 Demo 帳號', () => {
    const countsOf = async (email: string) => {
      const { id } = await userOf(email);
      return {
        accounts: await prisma.account.count({ where: { userId: id } }),
        transactions: await prisma.transaction.count({
          where: { userId: id },
        }),
        loans: await prisma.loan.count({ where: { userId: id } }),
        goals: await prisma.goal.count({ where: { userId: id } }),
      };
    };

    it('跑兩次：資料一樣多，不會重複', async () => {
      await run();
      const first = await countsOf(DEMO_EMAIL);
      await run();
      expect(await countsOf(DEMO_EMAIL)).toEqual(first);
      expect(
        await prisma.user.count({
          where: { email: { in: [DEMO_EMAIL, DEMO_NEW_EMAIL] } },
        }),
      ).toBe(2);
    });

    it('Demo 資料被改壞後重跑 → 恢復原狀', async () => {
      await run();
      const first = await countsOf(DEMO_EMAIL);
      const { id } = await userOf(DEMO_EMAIL);
      await prisma.transaction.deleteMany({ where: { userId: id } });

      await run();
      expect(await countsOf(DEMO_EMAIL)).toEqual(first);
    });

    it('不刪除、不修改其他使用者', async () => {
      const otherId = await createUser(prisma, 'jason-01@moneymate.test');
      await prisma.account.create({
        data: {
          userId: otherId,
          name: '別人的帳戶',
          accountType: AccountType.bank,
          openingBalance: '1234.00',
        },
      });

      await run();
      await run();

      const accounts = await prisma.account.findMany({
        where: { userId: otherId },
      });
      expect(accounts).toHaveLength(1);
      expect(accounts[0].openingBalance.toFixed(2)).toBe('1234.00');
    });

    it('密碼太短 → 直接失敗，原本的 Demo 資料不會被刪', async () => {
      await run();
      const before = await userOf(DEMO_EMAIL);

      await expect(run('short')).rejects.toThrow('DEMO_PASSWORD');

      expect((await userOf(DEMO_EMAIL)).id).toBe(before.id);
    });
  });
});
