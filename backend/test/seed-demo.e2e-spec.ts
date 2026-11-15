import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { addDays, fromDbDate } from '../src/common/date-only.js';
import { AccountsService } from '../src/modules/accounts/index.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { BillsService } from '../src/modules/bills/index.js';
import { LoansService } from '../src/modules/loans/index.js';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service.js';
import { TransactionsService } from '../src/modules/transactions/index.js';
import { PrismaService } from '../src/prisma/index.js';
import {
  DEMO_EMAIL,
  DEMO_NEW_EMAIL,
  seedDemo,
  type DemoSeedResult,
} from '../src/seed/demo-data.js';
import { createTestApp } from './utils/create-test-app.js';
import { createUser, resetDb } from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';

const TODAY = '2026-11-15';
const PASSWORD = 'demo-password-for-test';

/** Demo seed（PRD 第二十八節）：一行指令重建、可以重複執行、不動其他使用者 */
describe('Demo 帳號 seed（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FakeClock;

  const run = (): Promise<DemoSeedResult> =>
    seedDemo(
      {
        prisma,
        clock,
        auth: app.get(AuthService),
        onboarding: app.get(OnboardingService),
        accounts: app.get(AccountsService),
        transactions: app.get(TransactionsService),
        loans: app.get(LoansService),
        bills: app.get(BillsService),
      },
      PASSWORD,
    );

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
    if (prisma) await resetDb(prisma);
    await app?.close();
  });

  it('空的資料庫：建出 Demo 帳號的問卷、帳戶、12 個月交易、房貸、帳單，以及未填問卷的新帳號', async () => {
    const result = await run();
    const userId = result.demoUserId;

    // 系統分類一起建好，新資料庫一行指令就能重建
    expect(await prisma.category.count({ where: { userId: null } })).toBe(12);

    const goal = await prisma.goal.findUniqueOrThrow({ where: { userId } });
    expect(goal.monthlySpending.toString()).toBe('40000');

    const accounts = await prisma.account.findMany({ where: { userId } });
    expect(accounts.map((a) => a.accountType).sort()).toEqual([
      'bank',
      'bank',
      'cash',
      'credit_card',
      'investment',
    ]);
    const estimate = accounts.find((a) => a.isEstimate);
    expect(estimate?.openingBalance.toString()).toBe('680000');
    expect(
      accounts.filter((a) => a.deductedFromEstimate !== null),
    ).toHaveLength(1);

    const txs = await prisma.transaction.findMany({ where: { userId } });
    expect(txs.length).toBe(result.transactions);
    const dates = txs.map((t) => fromDbDate(t.transactionDate)).sort();
    expect(dates[0].slice(0, 7)).toBe('2025-12');
    expect(dates.at(-1)! <= TODAY).toBe(true);
    const types = new Set(txs.map((t) => t.transactionType));
    expect(types).toEqual(new Set(['income', 'expense', 'transfer']));
    const card = accounts.find((a) => a.accountType === 'credit_card');
    expect(
      txs.some(
        (t) => t.transactionType === 'transfer' && t.toAccountId === card?.id,
      ),
    ).toBe(true);

    const loans = await prisma.loan.findMany({ where: { userId } });
    expect(loans).toHaveLength(1);
    expect(loans[0].loanType).toBe('mortgage');
    expect(clock.now().getTime() - loans[0].balanceUpdatedAt.getTime()).toBe(
      60 * 86_400_000,
    );

    const bills = await prisma.bill.findMany({ where: { userId } });
    const pending = bills.filter((b) => b.status === 'pending');
    const dueDates = pending.map((b) => fromDbDate(b.dueDate));
    expect(dueDates.filter((d) => d < TODAY)).toHaveLength(1);
    expect(
      dueDates.filter((d) => d >= TODAY && d <= addDays(TODAY, 14)),
    ).toHaveLength(1);
    const series = new Map<string, number>();
    for (const b of bills.filter((x) => x.status === 'paid')) {
      series.set(b.seriesId, (series.get(b.seriesId) ?? 0) + 1);
    }
    expect([...series.values()]).toEqual([3]);

    const fresh = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_NEW_EMAIL },
      include: { goal: true, accounts: true },
    });
    expect(fresh.goal).toBeNull();
    expect(fresh.accounts).toHaveLength(0);

    // 用 DEMO_PASSWORD 登入得了
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: DEMO_EMAIL, password: PASSWORD })
      .expect(200);
  });

  it('重複執行：重建成相同的筆數，不動其他使用者的資料', async () => {
    const otherId = await createUser(prisma, 'someone@example.com');
    await prisma.account.create({
      data: {
        userId: otherId,
        name: '別人的帳戶',
        accountType: 'cash',
        openingBalance: '100',
      },
    });

    const first = await run();
    const second = await run();

    expect(second.demoUserId).not.toBe(first.demoUserId);
    expect({ ...second, demoUserId: '', newUserId: '' }).toEqual({
      ...first,
      demoUserId: '',
      newUserId: '',
    });
    expect(await prisma.user.count()).toBe(3);
    expect(
      await prisma.transaction.count({ where: { userId: second.demoUserId } }),
    ).toBe(second.transactions);
    expect(await prisma.account.count({ where: { userId: otherId } })).toBe(1);
  });

  it('月底執行也能建好（2 月、閏年）', async () => {
    clock.setTaipeiDate('2028-02-29');
    const result = await run();
    expect(result.transactions).toBeGreaterThan(100);
    expect(result.bills).toBe(6);
  });
});
