import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { FinanceCalcService } from '../src/modules/finance/index.js';
import {
  buildMilestones,
  goalPercent,
} from '../src/modules/goals/goal-progress.js';
import { PrismaService } from '../src/prisma/index.js';
import {
  E2E_DASHBOARD_EMAIL,
  E2E_GOAL_EMAIL,
  E2E_NEW_EMAIL,
  seedE2e,
} from '../src/seed/e2e-fixtures.js';
import { createTestApp } from './utils/create-test-app.js';
import { createUser, resetDb } from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';

const TODAY = '2026-11-12';
const PASSWORD = 'e2e-password-123';

describe('seed:e2e 端到端測試帳號（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FakeClock;

  const api = () => request(app.getHttpServer());
  const run = (password: string | undefined = PASSWORD) =>
    seedE2e(app, password);
  const idOf = async (email: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const login = async (email: string) => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const body = res.body as {
      accessToken: string;
      user: { hasCompletedOnboarding: boolean };
    };
    return {
      auth: `Bearer ${body.accessToken}`,
      onboarded: body.user.hasCompletedOnboarding,
    };
  };

  /** 帳戶合計、淨資產、目標百分比與下一站（goals 的純函式＋C 的 FinanceCalcService） */
  async function numbers(email: string) {
    const userId = await idOf(email);
    const finance = app.get(FinanceCalcService);
    const goal = await prisma.goal.findUniqueOrThrow({ where: { userId } });
    const total = await finance.getAccountsTotal(userId, TODAY);
    const balances = await finance.getAccountBalances(userId, TODAY);
    const next = buildMilestones(goal.targetAmount, total).next;
    return {
      target: goal.targetAmount.toFixed(2),
      balances: Object.fromEntries(
        balances.map((b) => [b.accountType, b.balance.toFixed(2)]),
      ),
      total: total.toFixed(2),
      netWorth: (await finance.getNetWorth(userId, TODAY)).toFixed(2),
      percent: goalPercent(goal.targetAmount, total),
      next: next && {
        index: next.index,
        remaining: next.remaining.toFixed(2),
      },
    };
  }

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

  it('e2e-new：可以登入，還沒做問卷，沒有任何資料', async () => {
    await run();

    expect((await login(E2E_NEW_EMAIL)).onboarded).toBe(false);
    const userId = await idOf(E2E_NEW_EMAIL);
    expect(await prisma.account.count({ where: { userId } })).toBe(0);
    expect(await prisma.goal.count({ where: { userId } })).toBe(0);
  });

  describe('e2e-dashboard：Dashboard 驗算案例（AC-22）', () => {
    it('GET /dashboard/summary：收入 50,000、支出 110,000、儲蓄率 −120.0%、合計 240,000、淨資產 −760,000', async () => {
      await run();

      const { auth, onboarded } = await login(E2E_DASHBOARD_EMAIL);
      expect(onboarded).toBe(true);
      const res = await api()
        .get('/api/v1/dashboard/summary')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({
        month: '2026-11',
        income: '50000.00',
        expense: '110000.00',
        savingsRate: -120,
        accountsTotal: '240000.00',
        netWorth: '-760000.00',
      });
    });

    it('銀行 260,000、信用卡 −20,000；目標 1,200 萬 → 2.0%，第 2 站再存 760,000', async () => {
      await run();

      expect(await numbers(E2E_DASHBOARD_EMAIL)).toEqual({
        target: '12000000.00',
        balances: { bank: '260000.00', credit_card: '-20000.00' },
        total: '240000.00',
        netWorth: '-760000.00',
        percent: 2,
        next: { index: 2, remaining: '760000.00' },
      });
    });
  });

  it('e2e-goal：目標驗算案例（AC-16）銀行 30 萬＋信用卡 −5 萬 → 2.1%，第 2 站再存 750,000', async () => {
    await run();

    expect((await login(E2E_GOAL_EMAIL)).onboarded).toBe(true);
    expect(await numbers(E2E_GOAL_EMAIL)).toEqual({
      target: '12000000.00',
      balances: { bank: '300000.00', credit_card: '-50000.00' },
      total: '250000.00',
      netWorth: '250000.00',
      percent: 2.1,
      next: { index: 2, remaining: '750000.00' },
    });
  });

  it('本月 1 號就是今天時也能建立（交易日期不會在未來）', async () => {
    clock.setTaipeiDate('2026-12-01');
    await run();

    const userId = await idOf(E2E_DASHBOARD_EMAIL);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(4);
  });

  it('可以重複執行：資料不會變兩份', async () => {
    await run();
    await run();

    const userId = await idOf(E2E_DASHBOARD_EMAIL);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(4);
    expect(await prisma.account.count({ where: { userId } })).toBe(2);
    expect(await prisma.loan.count({ where: { userId } })).toBe(1);
    expect(
      await prisma.user.count({
        where: {
          email: { in: [E2E_NEW_EMAIL, E2E_DASHBOARD_EMAIL, E2E_GOAL_EMAIL] },
        },
      }),
    ).toBe(3);
  });

  it('不會動到其他使用者（包含其他 @moneymate.test 的測試帳號）', async () => {
    const other = await createUser(prisma, 'jason-01@moneymate.test');
    await run();

    expect(await prisma.user.count({ where: { id: other } })).toBe(1);
  });

  it.each([
    ['沒有設定', undefined],
    ['少於 8 個字', 'short'],
  ])(
    'E2E_PASSWORD %s → 直接失敗，原本的測試帳號不會被刪',
    async (_, password) => {
      await run();
      const before = await idOf(E2E_DASHBOARD_EMAIL);

      // 直接呼叫 seedE2e：run(undefined) 會用預設密碼
      await expect(seedE2e(app, password)).rejects.toThrow('E2E_PASSWORD');
      expect(await idOf(E2E_DASHBOARD_EMAIL)).toBe(before);
    },
  );
});
