import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { toDbDate, type DateOnly } from '../src/common/date-only.js';
import { FinanceCalcService } from '../src/modules/finance/index.js';
import { LoansService } from '../src/modules/loans/index.js';
import {
  AccountType,
  LoanStatus,
  PrismaService,
  type LoanStatus as LoanStatusType,
} from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { createUser, resetDb } from './utils/db.js';

const TODAY = '2026-10-28';

/**
 * LOAN-5：getLoanSummary 直接連 app_test 查詢（不經 HTTP）。
 * 計算規則的邊界在 src/modules/loans/loan-summary.spec.ts；這裡只測查詢條件：
 * 只算登入者的貸款、只算 active，以及資料庫的金額與日期轉換。
 */
describe('getLoanSummary（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let loans: LoansService;
  let finance: FinanceCalcService;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    loans = app.get(LoansService);
    finance = app.get(FinanceCalcService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'loan-owner@example.com');
    otherId = await createUser(prisma, 'loan-other@example.com');
  });

  async function createLoan(
    owner: string,
    data: {
      name: string;
      outstandingBalance: string;
      paymentDay: number;
      endDate?: DateOnly;
      status?: LoanStatusType;
    },
  ): Promise<string> {
    const loan = await prisma.loan.create({
      data: {
        userId: owner,
        loanType: 'mortgage',
        monthlyPayment: '17969.00',
        name: data.name,
        outstandingBalance: data.outstandingBalance,
        paymentDay: data.paymentDay,
        endDate: toDbDate(data.endDate ?? '2031-09-30'),
        status: data.status ?? LoanStatus.active,
      },
      select: { id: true },
    });
    return loan.id;
  }

  it('沒有貸款時回 0 筆、0 元、空的還款日', async () => {
    const s = await loans.getLoanSummary(userId, TODAY);
    expect(s.activeCount).toBe(0);
    expect(s.outstandingTotal.toFixed(2)).toBe('0.00');
    expect(s.upcomingPayments).toEqual([]);
  });

  it('只算登入者 active 的貸款：已結清與別人的貸款不算（US-L11、AC-02）', async () => {
    const mortgage = await createLoan(userId, {
      name: '房貸',
      outstandingBalance: '1000000.00',
      paymentDay: 5,
    });
    await createLoan(userId, {
      name: '學貸',
      outstandingBalance: '320000.00',
      paymentDay: 5,
      status: LoanStatus.closed,
    });
    await createLoan(otherId, {
      name: '別人的車貸',
      outstandingBalance: '500000.00',
      paymentDay: 5,
    });

    const s = await loans.getLoanSummary(userId, TODAY);

    expect(s.activeCount).toBe(1);
    expect(s.outstandingTotal.toFixed(2)).toBe('1000000.00');
    expect(s.upcomingPayments).toEqual([
      expect.objectContaining({
        loanId: mortgage,
        name: '房貸',
        date: '2026-11-05',
        daysUntilDue: 8,
      }),
    ]);
    expect(s.upcomingPayments[0]?.monthlyPayment.toFixed(2)).toBe('17969.00');
  });

  it('金額從資料庫讀出後加總不失真', async () => {
    await createLoan(userId, {
      name: 'A',
      outstandingBalance: '0.10',
      paymentDay: 20,
    });
    await createLoan(userId, {
      name: 'B',
      outstandingBalance: '0.20',
      paymentDay: 20,
    });
    await createLoan(userId, {
      name: 'C',
      outstandingBalance: '999999999999.99',
      paymentDay: 20,
    });

    const s = await loans.getLoanSummary(userId, TODAY);

    expect(s.outstandingTotal.toFixed(2)).toBe('1000000000000.29');
  });

  it('結清日從資料庫讀出後照日期比較：還款日晚於結清日的不列（Q10）', async () => {
    await createLoan(userId, {
      name: '快結清的車貸',
      outstandingBalance: '8500.00',
      paymentDay: 5,
      endDate: '2026-11-03',
    });
    const onEndDate = await createLoan(userId, {
      name: '最後一期的學貸',
      outstandingBalance: '3000.00',
      paymentDay: 5,
      endDate: '2026-11-05',
    });

    const s = await loans.getLoanSummary(userId, TODAY);

    expect(s.activeCount).toBe(2);
    expect(s.upcomingPayments.map((p) => p.loanId)).toEqual([onEndDate]);
  });

  it('新增房貸後淨資產減少、帳戶合計不變；改成已結清後淨資產回升（US-L19、AC-22）', async () => {
    await prisma.account.create({
      data: {
        userId,
        name: '台新',
        accountType: AccountType.bank,
        openingBalance: '300000.00',
      },
    });
    const mortgage = await createLoan(userId, {
      name: '房貸',
      outstandingBalance: '1000000.00',
      paymentDay: 5,
    });

    const before = await loans.getLoanSummary(userId, TODAY);
    expect(before.outstandingTotal.toFixed(2)).toBe('1000000.00');
    expect((await finance.getNetWorth(userId, TODAY)).toFixed(2)).toBe(
      '-700000.00',
    );
    // 目標進度用的帳戶合計不扣貸款（PRD 15.3）
    expect((await finance.getAccountsTotal(userId, TODAY)).toFixed(2)).toBe(
      '300000.00',
    );

    // 只改狀態，餘額照存（Q9）：已結清的不算，淨資產回升
    await prisma.loan.update({
      where: { id: mortgage },
      data: { status: LoanStatus.closed },
    });

    const after = await loans.getLoanSummary(userId, TODAY);
    expect(after.activeCount).toBe(0);
    expect(after.outstandingTotal.toFixed(2)).toBe('0.00');
    expect(after.upcomingPayments).toEqual([]);
    expect((await finance.getNetWorth(userId, TODAY)).toFixed(2)).toBe(
      '300000.00',
    );
  });
});
