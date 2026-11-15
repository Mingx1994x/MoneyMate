import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { databaseException } from '../src/common/errors/database-exception.js';
import {
  ESTIMATE_ACCOUNT_NAME,
  OnboardingService,
} from '../src/modules/onboarding/onboarding.service.js';
import { AccountType, Prisma, PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { createUser, resetDb } from './utils/db.js';

/** 失敗的原因轉成錯誤代碼：AppException 直接讀 code，資料庫錯誤照 filter 的對照表轉 */
const codeOf = (reason: unknown): string | undefined =>
  (reason as { code?: unknown }).code === 'ONBOARDING_ALREADY_DONE'
    ? 'ONBOARDING_ALREADY_DONE'
    : databaseException(reason)?.code;

describe('問卷寫入（OnboardingService，e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let onboarding: OnboardingService;
  let userId: string;

  const counts = async () => ({
    goals: await prisma.goal.count({ where: { userId } }),
    accounts: await prisma.account.count({ where: { userId } }),
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    onboarding = app.get(OnboardingService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'd-onboarding@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC-15：建立目標（每月 4 萬 → 1,200 萬）與估計帳戶（80 萬）', async () => {
    await onboarding.submit(userId, {
      monthlySpending: 40000,
      currentAssets: 800000,
    });

    const goal = await prisma.goal.findUniqueOrThrow({ where: { userId } });
    expect(goal.name).toBe('財富自由');
    expect(goal.monthlySpending.toFixed(2)).toBe('40000.00');
    expect(goal.targetAmount.toFixed(2)).toBe('12000000.00');
    expect(goal.birthYear).toBeNull();
    expect(goal.estMonthlySaving).toBeNull();

    const accounts = await prisma.account.findMany({ where: { userId } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      name: ESTIMATE_ACCOUNT_NAME,
      accountType: AccountType.bank,
      isEstimate: true,
      isActive: true,
      deductedFromEstimate: null,
    });
    expect(accounts[0].openingBalance.toFixed(2)).toBe('800000.00');
  });

  it.each([
    ['省略', {}],
    ['null', { currentAssets: null }],
  ])('跳過 Q2（currentAssets %s）→ 估計帳戶 0 元', async (_, q2) => {
    await onboarding.submit(userId, { monthlySpending: 30000, ...q2 });

    const account = await prisma.account.findFirstOrThrow({
      where: { userId, isEstimate: true },
    });
    expect(account.openingBalance.toFixed(2)).toBe('0.00');
  });

  it('已經完成問卷再送一次 → ONBOARDING_ALREADY_DONE，不會多一筆', async () => {
    await onboarding.submit(userId, { monthlySpending: 40000 });

    await expect(
      onboarding.submit(userId, { monthlySpending: 50000 }),
    ).rejects.toMatchObject({ code: 'ONBOARDING_ALREADY_DONE' });

    expect(await counts()).toEqual({ goals: 1, accounts: 1 });
    const goal = await prisma.goal.findUniqueOrThrow({ where: { userId } });
    expect(goal.monthlySpending.toFixed(2)).toBe('40000.00');
  });

  it('同時送出 5 次 → 只有 1 次成功，其他都是 ONBOARDING_ALREADY_DONE', async () => {
    const results = await Promise.allSettled(
      [30000, 40000, 50000, 80000, 100000].map((monthlySpending) =>
        onboarding.submit(userId, { monthlySpending }),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed.map((r) => codeOf(r.reason))).toEqual(
      Array(4).fill('ONBOARDING_ALREADY_DONE'),
    );
    expect(await counts()).toEqual({ goals: 1, accounts: 1 });
  });

  it('估計帳戶建立失敗 → 目標也不會留下（同一個交易）', async () => {
    // 先放一個估計帳戶，問卷建第二個時 createAccount 會丟 CONFLICT
    await prisma.account.create({
      data: {
        userId,
        name: '舊的估計帳戶',
        accountType: AccountType.bank,
        openingBalance: new Prisma.Decimal(0),
        isEstimate: true,
      },
    });

    await expect(
      onboarding.submit(userId, { monthlySpending: 40000 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(await counts()).toEqual({ goals: 0, accounts: 1 });
  });

  it('只寫入自己的資料：別人已完成問卷不影響我', async () => {
    const otherId = await createUser(prisma, 'd-onboarding-other@example.com');
    await onboarding.submit(otherId, { monthlySpending: 40000 });

    await onboarding.submit(userId, { monthlySpending: 30000 });

    expect(await counts()).toEqual({ goals: 1, accounts: 1 });
  });
});
