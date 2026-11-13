import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { toDbDate, type DateOnly } from '../src/common/date-only.js';
import { ClockService } from '../src/clock/clock.service.js';
import type { GoalProgressDto } from '../src/modules/goals/dto/goal-progress.dto.js';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service.js';
import {
  AccountType,
  LoanStatus,
  PrismaService,
  TransactionType,
} from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  createTransaction,
  createUser,
  resetDb,
  seedCategories,
} from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

/** 台北的今天：本月是 2026-11，最近 6 個完整月是 2026-10 ～ 2026-05 */
const TODAY = '2026-11-11';

const bodyOf = (res: { body: unknown }): GoalProgressDto =>
  res.body as GoalProgressDto;

describe('目標進度 GET /goal/progress、送出問卷 POST /onboarding（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FakeClock;
  let userId: string;
  let auth: string;
  let categories: Record<string, string>;

  const api = () => request(app.getHttpServer());
  const progress = (token = auth) =>
    api().get('/api/v1/goal/progress').set('Authorization', token);
  const onboard = (
    owner: string,
    dto: { monthlySpending: number; currentAssets?: number },
  ) => app.get(OnboardingService).submit(owner, dto);

  async function createAccount(
    owner: string,
    accountType: AccountType,
    openingBalance: string,
    isActive = true,
  ): Promise<string> {
    const a = await prisma.account.create({
      data: {
        userId: owner,
        name: `${accountType}-${openingBalance}`,
        accountType,
        openingBalance,
        isActive,
      },
      select: { id: true },
    });
    return a.id;
  }

  /** 某個月記一筆收入、一筆支出（日期是該月 15 號）；金額 > 0（資料庫 CHECK），不要傳 0 */
  async function recordMonth(
    accountId: string,
    month: string,
    income: string,
    expense: string,
    owner = userId,
  ): Promise<void> {
    const date: DateOnly = `${month}-15`;
    await createTransaction(prisma, {
      userId: owner,
      accountId,
      transactionType: TransactionType.income,
      amount: income,
      transactionDate: date,
      categoryId: categories.salary,
    });
    await createTransaction(prisma, {
      userId: owner,
      accountId,
      transactionType: TransactionType.expense,
      amount: expense,
      transactionDate: date,
      categoryId: categories.food,
    });
  }

  async function createLoan(
    owner: string,
    outstandingBalance: string,
    status: LoanStatus = LoanStatus.active,
  ): Promise<void> {
    await prisma.loan.create({
      data: {
        userId: owner,
        name: `房貸-${outstandingBalance}`,
        loanType: 'mortgage',
        outstandingBalance,
        monthlyPayment: '17969.00',
        paymentDay: 5,
        endDate: toDbDate('2031-09-30'),
        status,
      },
    });
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
    categories = await seedCategories(prisma);
    userId = await createUser(prisma, 'd-progress@example.com');
    auth = await bearer(app, userId);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /goal/progress', () => {
    it('還沒完成問卷 → 409 ONBOARDING_REQUIRED', async () => {
      const res = await progress().expect(409);
      expect(res.body).toMatchObject({ code: 'ONBOARDING_REQUIRED' });
    });

    it('AC-16：每月 4 萬、銀行 30 萬＋信用卡 −5 萬 → 目前 25 萬、2.1%，第 2 站再存 75 萬', async () => {
      await onboard(userId, { monthlySpending: 40000 });
      await createAccount(userId, AccountType.bank, '300000.00');
      await createAccount(userId, AccountType.credit_card, '-50000.00');

      const res = await progress().expect(200);
      expect(res.body).toEqual({
        targetAmount: '12000000.00',
        currentAmount: '250000.00',
        remaining: '11750000.00',
        percent: 2.1,
        achieved: false,
        milestones: [
          { index: 1, amount: '100000.00', label: '緊急預備金', reached: true },
          { index: 2, amount: '1000000.00', label: '第一桶金', reached: false },
          { index: 3, amount: '6000000.00', label: '一半', reached: false },
          {
            index: 4,
            amount: '12000000.00',
            label: '財富自由',
            reached: false,
          },
        ],
        nextMilestone: {
          index: 2,
          amount: '1000000.00',
          label: '第一桶金',
          reached: false,
          remaining: '750000.00',
        },
        fireAge: null,
        fireAgeStatus: 'need_birth_year',
        fireAssumptions: {
          annualSpending: '480000.00',
          annualSaving: null,
          savingSource: null,
          currentAssets: '250000.00',
          age: null,
        },
        activeLoanTotal: '0.00',
      });
    });

    it('AC-17：每月 5,000 → 10 萬、75 萬、100 萬、150 萬', async () => {
      await onboard(userId, { monthlySpending: 5000 });
      const res = await progress().expect(200);
      expect(
        bodyOf(res).milestones.map((m: { amount: string }) => m.amount),
      ).toEqual(['100000.00', '750000.00', '1000000.00', '1500000.00']);
    });

    it('目前金額只算啟用帳戶，含估計帳戶；停用帳戶不算', async () => {
      await onboard(userId, { monthlySpending: 40000, currentAssets: 800000 });
      await createAccount(userId, AccountType.investment, '200000.00');
      await createAccount(userId, AccountType.bank, '0.00', false);

      const res = await progress().expect(200);
      expect(bodyOf(res).currentAmount).toBe('1000000.00');
      expect(bodyOf(res).fireAssumptions.currentAssets).toBe('1000000.00');
    });

    it('AC-19：預記下個月的薪水，不會增加目前金額', async () => {
      await onboard(userId, { monthlySpending: 40000 });
      const bank = await createAccount(userId, AccountType.bank, '300000.00');
      await createTransaction(prisma, {
        userId,
        accountId: bank,
        transactionType: TransactionType.income,
        amount: '50000.00',
        transactionDate: '2026-12-05',
        categoryId: categories.salary,
      });

      const res = await progress().expect(200);
      expect(bodyOf(res).currentAmount).toBe('300000.00');
    });

    it('目前金額是負的 → 0%，還差 ＝ 目標 ＋ 欠款', async () => {
      await onboard(userId, { monthlySpending: 40000 });
      await createAccount(userId, AccountType.credit_card, '-50000.00');

      const res = await progress().expect(200);
      expect(res.body).toMatchObject({
        currentAmount: '-50000.00',
        remaining: '12050000.00',
        percent: 0,
        achieved: false,
      });
      expect(bodyOf(res).nextMilestone).toMatchObject({
        index: 1,
        remaining: '150000.00',
      });
    });

    it('目前 ≥ 目標 → 100%、已達成、還差 0、沒有下一站、FIRE achieved（沒填出生年也是）', async () => {
      await onboard(userId, { monthlySpending: 5000, currentAssets: 2000000 });

      const res = await progress().expect(200);
      expect(res.body).toMatchObject({
        targetAmount: '1500000.00',
        currentAmount: '2000000.00',
        remaining: '0.00',
        percent: 100,
        achieved: true,
        nextMilestone: null,
        fireAge: null,
        fireAgeStatus: 'achieved',
      });
      expect(
        bodyOf(res).milestones.every((m: { reached: boolean }) => m.reached),
      ).toBe(true);
    });

    it('AC-27：40 歲、年支出 60 萬、自估年儲蓄 60 萬、資產 500 萬 → 51 歲（estimate）', async () => {
      await onboard(userId, { monthlySpending: 50000, currentAssets: 5000000 });
      await prisma.goal.update({
        where: { userId },
        data: { birthYear: 1986, estMonthlySaving: '50000.00' },
      });

      const res = await progress().expect(200);
      expect(res.body).toMatchObject({
        fireAge: 51,
        fireAgeStatus: 'ok',
        fireAssumptions: {
          annualSpending: '600000.00',
          annualSaving: '600000.00',
          savingSource: 'estimate',
          currentAssets: '5000000.00',
          age: 40,
        },
      });
    });

    it('有出生年、沒有記帳也沒有自估儲蓄 → need_saving', async () => {
      await onboard(userId, { monthlySpending: 40000 });
      await prisma.goal.update({
        where: { userId },
        data: { birthYear: 1990 },
      });

      const res = await progress().expect(200);
      expect(res.body).toMatchObject({
        fireAge: null,
        fireAgeStatus: 'need_saving',
        fireAssumptions: { annualSaving: null, savingSource: null, age: 36 },
      });
    });

    it('年儲蓄是負的、資產報酬不夠 → unreachable', async () => {
      await onboard(userId, { monthlySpending: 40000 });
      await prisma.goal.update({
        where: { userId },
        data: { birthYear: 1990, estMonthlySaving: '-10000.00' },
      });

      const res = await progress().expect(200);
      expect(res.body).toMatchObject({
        fireAge: null,
        fireAgeStatus: 'unreachable',
      });
    });

    describe('年儲蓄：有 3 個以上完整月的記帳時用實際平均（PRD 15.7）', () => {
      let bank: string;

      beforeEach(async () => {
        await onboard(userId, {
          monthlySpending: 50000,
          currentAssets: 5000000,
        });
        await prisma.goal.update({
          where: { userId },
          data: { birthYear: 1986, estMonthlySaving: '10000.00' },
        });
        bank = await createAccount(userId, AccountType.bank, '0.00');
      });

      it('3 個完整月 → 用實際平均 × 12，不用自估值（actual）', async () => {
        await recordMonth(bank, '2026-10', '100000.00', '50000.00');
        await recordMonth(bank, '2026-09', '100000.00', '50000.00');
        await recordMonth(bank, '2026-08', '100000.00', '50000.00');

        const res = await progress().expect(200);
        expect(bodyOf(res).fireAssumptions).toMatchObject({
          annualSaving: '600000.00',
          savingSource: 'actual',
        });
      });

      it('只有 2 個完整月 → 用自估值（estimate）', async () => {
        await recordMonth(bank, '2026-10', '100000.00', '50000.00');
        await recordMonth(bank, '2026-09', '100000.00', '50000.00');

        const res = await progress().expect(200);
        expect(bodyOf(res).fireAssumptions).toMatchObject({
          annualSaving: '120000.00',
          savingSource: 'estimate',
        });
      });

      it('本月的記帳不算完整月', async () => {
        await recordMonth(bank, '2026-11', '100000.00', '50000.00');
        await recordMonth(bank, '2026-10', '100000.00', '50000.00');
        await recordMonth(bank, '2026-09', '100000.00', '50000.00');

        const res = await progress().expect(200);
        expect(bodyOf(res).fireAssumptions.savingSource).toBe('estimate');
      });

      it('只看最近 6 個完整月：第 7 個月以前的不算', async () => {
        // 2026-04 是第 7 個完整月：存很多，但不該算進平均
        await recordMonth(bank, '2026-04', '900000.00', '1.00');
        await recordMonth(bank, '2026-10', '100000.00', '70000.00');
        await recordMonth(bank, '2026-07', '100000.00', '70000.00');
        await recordMonth(bank, '2026-05', '100000.00', '70000.00');

        const res = await progress().expect(200);
        // 中間沒記帳的月不算進平均：(30,000 × 3) ÷ 3 × 12
        expect(bodyOf(res).fireAssumptions).toMatchObject({
          annualSaving: '360000.00',
          savingSource: 'actual',
        });
      });

      it('轉帳不算收支', async () => {
        const card = await createAccount(
          userId,
          AccountType.credit_card,
          '0.00',
        );
        for (const month of ['2026-10', '2026-09', '2026-08']) {
          await createTransaction(prisma, {
            userId,
            accountId: bank,
            transactionType: TransactionType.transfer,
            amount: '20000.00',
            transactionDate: `${month}-20`,
            toAccountId: card,
          });
        }

        const res = await progress().expect(200);
        expect(bodyOf(res).fireAssumptions.savingSource).toBe('estimate');
      });

      it('平均有小數 → 年儲蓄四捨五入到 2 位', async () => {
        await recordMonth(bank, '2026-10', '100000.00', '50000.00');
        await recordMonth(bank, '2026-09', '100000.00', '50000.00');
        await recordMonth(bank, '2026-08', '100000.01', '50000.00');

        const res = await progress().expect(200);
        // 平均每月 50,000.00333… × 12 ＝ 600,000.04
        expect(bodyOf(res).fireAssumptions.annualSaving).toBe('600000.04');
      });
    });

    it('active 貸款只顯示合計，不扣目前金額；已結清的不算', async () => {
      await onboard(userId, { monthlySpending: 40000, currentAssets: 800000 });
      await createLoan(userId, '1000000.00');
      await createLoan(userId, '300000.00', LoanStatus.closed);

      const res = await progress().expect(200);
      expect(res.body).toMatchObject({
        currentAmount: '800000.00',
        activeLoanTotal: '1000000.00',
      });
    });

    it('只算自己的資料：別人的帳戶、記帳、貸款都不算（AC-02）', async () => {
      await onboard(userId, { monthlySpending: 40000, currentAssets: 100000 });
      await prisma.goal.update({
        where: { userId },
        data: { birthYear: 1990 },
      });

      const otherId = await createUser(prisma, 'd-progress-other@example.com');
      await onboard(otherId, { monthlySpending: 80000, currentAssets: 900000 });
      const otherBank = await createAccount(otherId, AccountType.bank, '0.00');
      for (const month of ['2026-10', '2026-09', '2026-08']) {
        await recordMonth(otherBank, month, '100000.00', '10000.00', otherId);
      }
      await createLoan(otherId, '500000.00');

      const res = await progress().expect(200);
      expect(res.body).toMatchObject({
        targetAmount: '12000000.00',
        currentAmount: '100000.00',
        activeLoanTotal: '0.00',
        fireAgeStatus: 'need_saving',
      });
    });
  });

  describe('POST /onboarding', () => {
    const submit = (body: object) =>
      api().post('/api/v1/onboarding').set('Authorization', auth).send(body);

    it('AC-15：回 201 和目標進度，之後 GET /goal/progress 拿到一樣的內容', async () => {
      const res = await submit({
        monthlySpending: 40000,
        currentAssets: 800000,
      }).expect(201);
      expect(res.body).toMatchObject({
        targetAmount: '12000000.00',
        currentAmount: '800000.00',
        percent: 6.7,
        fireAgeStatus: 'need_birth_year',
      });

      const again = await progress().expect(200);
      expect(again.body).toEqual(res.body);
    });

    it('跳過 Q2 → 目前金額 0', async () => {
      const res = await submit({ monthlySpending: 40000 }).expect(201);
      expect(res.body).toMatchObject({ currentAmount: '0.00', percent: 0 });
    });

    it('送第二次 → 409 ONBOARDING_ALREADY_DONE', async () => {
      await submit({ monthlySpending: 40000 }).expect(201);
      const res = await submit({ monthlySpending: 50000 }).expect(409);
      expect(res.body).toMatchObject({ code: 'ONBOARDING_ALREADY_DONE' });
    });

    it('每月花費不合法 → 400，什麼都沒寫入', async () => {
      const res = await submit({ monthlySpending: 500 }).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await prisma.goal.count({ where: { userId } })).toBe(0);
      expect(await prisma.account.count({ where: { userId } })).toBe(0);
    });
  });
});
