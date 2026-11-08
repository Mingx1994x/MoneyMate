import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { FinanceCalcService } from '../src/modules/finance/index.js';
import { LoansService, type LoanSummary } from '../src/modules/loans/index.js';
import {
  AccountType,
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

const TODAY = '2026-11-20';

/**
 * FinanceCalcService 驗算案例（PRD 15.1、AC-16、AC-22；Issue #59）。
 * 計算寫在 SQL 裡，所以直接連 app_test 資料庫呼叫 service，不經 HTTP。
 * 貸款換成固定回傳的假 LoansService（不受 E 的實作影響），只測 C 這邊的公式。
 */
describe('FinanceCalcService 驗算（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let calc: FinanceCalcService;
  let userId: string;
  let salary: string;
  let living: string;

  /**
   * 假的貸款摘要：每個測試可以改 outstanding 的值。
   * 用 vi.fn() 才能檢查呼叫參數，確認淨資產扣的是登入者、今天的貸款（PRD 第十九節權限檢查）。
   */
  let outstanding = new Prisma.Decimal(0);
  const getLoanSummary = vi.fn((): Promise<LoanSummary> =>
    Promise.resolve({
      activeCount: outstanding.isZero() ? 0 : 1,
      outstandingTotal: outstanding,
      upcomingPayments: [],
    }),
  );
  const fakeLoans: Pick<LoansService, 'getLoanSummary'> = { getLoanSummary };

  const account = async (
    owner: string,
    name: string,
    accountType: AccountType,
    openingBalance: number,
    opts: { isActive?: boolean; isEstimate?: boolean } = {},
  ): Promise<string> => {
    const a = await prisma.account.create({
      data: {
        userId: owner,
        name,
        accountType,
        openingBalance,
        isActive: opts.isActive ?? true,
        isEstimate: opts.isEstimate ?? false,
      },
      select: { id: true },
    });
    return a.id;
  };

  const income = (accountId: string, amount: string, date = '2026-11-05') =>
    createTransaction(prisma, {
      userId,
      accountId,
      transactionType: TransactionType.income,
      amount,
      transactionDate: date,
      categoryId: salary,
    });

  const expense = (accountId: string, amount: string, date = '2026-11-05') =>
    createTransaction(prisma, {
      userId,
      accountId,
      transactionType: TransactionType.expense,
      amount,
      transactionDate: date,
      categoryId: living,
    });

  const transfer = (
    from: string,
    to: string,
    amount: string,
    date = '2026-11-05',
  ) =>
    createTransaction(prisma, {
      userId,
      accountId: from,
      toAccountId: to,
      transactionType: TransactionType.transfer,
      amount,
      transactionDate: date,
    });

  /** 把 Decimal 轉成兩位小數字串，方便比對 */
  const s = (d: Prisma.Decimal | null) => d?.toFixed(2) ?? null;

  beforeAll(async () => {
    app = await createTestApp({
      override: (b) => b.overrideProvider(LoansService).useValue(fakeLoans),
    });
    prisma = app.get(PrismaService);
    calc = app.get(FinanceCalcService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    outstanding = new Prisma.Decimal(0);
    getLoanSummary.mockClear();
    userId = await createUser(prisma, 'c-finance@example.com');
    salary = await createCategory(prisma, 'salary', CategoryType.income);
    living = await createCategory(prisma, 'living', CategoryType.expense);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  describe('AC-22 Dashboard 驗算案例', () => {
    let bank: string;
    let card: string;

    beforeEach(async () => {
      bank = await account(userId, '銀行', AccountType.bank, 300000);
      card = await account(userId, '信用卡', AccountType.credit_card, 0);
      outstanding = new Prisma.Decimal(1000000); // 房貸未償 1,000,000
      await income(bank, '50000'); // 薪資
      await expense(card, '30000'); // 生活支出
      await expense(bank, '80000'); // 房租帳單
      await transfer(bank, card, '10000'); // 繳卡費
    });

    it('銀行 260,000、信用卡 −20,000', async () => {
      const balances = await calc.getAccountBalances(userId, TODAY);
      expect(balances.map((b) => [b.id, s(b.balance)])).toEqual([
        [bank, '260000.00'],
        [card, '-20000.00'],
      ]);
    });

    it('帳戶合計 240,000', async () => {
      expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('240000.00');
    });

    it('淨資產 −760,000（帳戶合計 − 房貸 1,000,000）', async () => {
      expect(s(await calc.getNetWorth(userId, TODAY))).toBe('-760000.00');
      // 扣的是登入者、今天的貸款：傳錯 userId 或 today 時這裡會失敗
      expect(getLoanSummary).toHaveBeenCalledTimes(1);
      expect(getLoanSummary).toHaveBeenCalledWith(userId, TODAY);
    });

    it('本月收入 50,000、支出 110,000（轉帳不計）', async () => {
      const m = await calc.getMonthlyTotals(userId, '2026-11', TODAY);
      expect([s(m.income), s(m.expense)]).toEqual(['50000.00', '110000.00']);
    });

    it('可用現金只有銀行 260,000（信用卡不算）', async () => {
      const cash = await calc.getAvailableCash(userId, TODAY);
      expect(s(cash.total)).toBe('260000.00');
      expect(cash.hasCashAccounts).toBe(true);
    });
  });

  it('AC-16 目前金額：銀行 300,000＋信用卡 −50,000 → 帳戶合計 250,000', async () => {
    await account(userId, '銀行', AccountType.bank, 300000);
    await account(userId, '信用卡', AccountType.credit_card, -50000);
    expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('250000.00');
  });

  it('AC-08 信用卡：刷 30,000、繳 20,000 → 銀行 80,000、信用卡 −10,000；本月支出只算 30,000', async () => {
    const bank = await account(userId, '銀行', AccountType.bank, 100000);
    const card = await account(userId, '信用卡', AccountType.credit_card, 0);
    await expense(card, '30000'); // 刷卡
    await transfer(bank, card, '20000'); // 繳卡費（部分繳款）

    const balances = await calc.getAccountBalances(userId, TODAY);
    expect(balances.map((b) => [b.id, s(b.balance)])).toEqual([
      [bank, '80000.00'],
      [card, '-10000.00'],
    ]);
    const m = await calc.getMonthlyTotals(userId, '2026-11', TODAY);
    expect([s(m.income), s(m.expense)]).toEqual(['0.00', '30000.00']);
  });

  it('AC-19 預記下個月的薪水：不增加目前餘額、本月收入、帳戶合計', async () => {
    const bank = await account(userId, '銀行', AccountType.bank, 10000);
    await income(bank, '50000', '2026-12-05');

    expect(s(await calc.getAccountBalance(userId, bank, TODAY))).toBe(
      '10000.00',
    );
    expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('10000.00');
    const m = await calc.getMonthlyTotals(userId, '2026-11', TODAY);
    expect(s(m.income)).toBe('0.00');
  });

  describe('PRD 15.1 各欄位的規則', () => {
    it('未來日期的交易不算進餘額、合計、淨資產、可用現金、月收支', async () => {
      const bank = await account(userId, '銀行', AccountType.bank, 1000);
      await income(bank, '500', '2026-11-21');
      await expense(bank, '200', '2026-11-30');

      expect(s(await calc.getAccountBalance(userId, bank, TODAY))).toBe(
        '1000.00',
      );
      expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('1000.00');
      expect(s(await calc.getNetWorth(userId, TODAY))).toBe('1000.00');
      expect(s((await calc.getAvailableCash(userId, TODAY)).total)).toBe(
        '1000.00',
      );
      const m = await calc.getMonthlyTotals(userId, '2026-11', TODAY);
      expect([s(m.income), s(m.expense)]).toEqual(['0.00', '0.00']);
    });

    it('今天的交易要算（日期 = today）', async () => {
      const bank = await account(userId, '銀行', AccountType.bank, 1000);
      await expense(bank, '300', TODAY);
      expect(s(await calc.getAccountBalance(userId, bank, TODAY))).toBe(
        '700.00',
      );
    });

    it('換一天看：today 往後移，原本的未來交易就算進去', async () => {
      const bank = await account(userId, '銀行', AccountType.bank, 1000);
      await income(bank, '500', '2026-11-21');
      expect(s(await calc.getAccountBalance(userId, bank, TODAY))).toBe(
        '1000.00',
      );
      expect(s(await calc.getAccountBalance(userId, bank, '2026-11-21'))).toBe(
        '1500.00',
      );
    });

    it('停用帳戶：不算帳戶合計、不算可用現金，淨資產照算（餘額 0）', async () => {
      const bank = await account(userId, '銀行', AccountType.bank, 1000);
      // 停用帳戶的餘額必為 0：初始 500，轉出 500 後停用
      const old = await account(userId, '舊帳戶', AccountType.bank, 500, {
        isActive: false,
      });
      await transfer(old, bank, '500');

      expect(s(await calc.getAccountBalance(userId, old, TODAY))).toBe('0.00');
      expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('1500.00');
      expect(s(await calc.getNetWorth(userId, TODAY))).toBe('1500.00');
      const cash = await calc.getAvailableCash(userId, TODAY);
      expect(s(cash.total)).toBe('1500.00');
    });

    it('停用帳戶的交易照樣算進月收支', async () => {
      const old = await account(userId, '舊帳戶', AccountType.bank, 0, {
        isActive: false,
      });
      await income(old, '800', '2026-11-03');
      await expense(old, '800', '2026-11-04');
      const m = await calc.getMonthlyTotals(userId, '2026-11', TODAY);
      expect([s(m.income), s(m.expense)]).toEqual(['800.00', '800.00']);
    });

    it('估計帳戶：算帳戶合計與淨資產，不算可用現金', async () => {
      await account(userId, '估計存款', AccountType.bank, 200000, {
        isEstimate: true,
      });
      expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('200000.00');
      expect(s(await calc.getNetWorth(userId, TODAY))).toBe('200000.00');
      const cash = await calc.getAvailableCash(userId, TODAY);
      expect(s(cash.total)).toBe('0.00');
      expect(cash.hasCashAccounts).toBe(false);
    });

    it('投資帳戶、信用卡：算帳戶合計，不算可用現金；cash＋bank 才算', async () => {
      await account(userId, '現金', AccountType.cash, 3000);
      await account(userId, '銀行', AccountType.bank, 7000);
      await account(userId, '股票', AccountType.investment, 50000);
      await account(userId, '信用卡', AccountType.credit_card, -4000);

      expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('56000.00');
      const cash = await calc.getAvailableCash(userId, TODAY);
      expect(s(cash.total)).toBe('10000.00');
      expect(cash.hasCashAccounts).toBe(true);
    });

    it('只有投資帳戶時 hasCashAccounts 是 false（不算 14 天資金缺口，AC-20）', async () => {
      await account(userId, '股票', AccountType.investment, 50000);
      const cash = await calc.getAvailableCash(userId, TODAY);
      expect(cash).toMatchObject({ hasCashAccounts: false });
      expect(s(cash.total)).toBe('0.00');
    });

    it('淨資產扣貸款，帳戶合計不扣', async () => {
      await account(userId, '銀行', AccountType.bank, 100000);
      outstanding = new Prisma.Decimal('30000.5');
      expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('100000.00');
      expect(s(await calc.getNetWorth(userId, TODAY))).toBe('69999.50');
      expect(getLoanSummary).toHaveBeenCalledWith(userId, TODAY);
    });

    it('換一天算淨資產：貸款也用同一個 today', async () => {
      await calc.getNetWorth(userId, '2026-12-01');
      expect(getLoanSummary).toHaveBeenCalledWith(userId, '2026-12-01');
    });

    it('傳入 loanOutstanding（dashboard 已查過貸款）：直接用它扣，不再呼叫 getLoanSummary', async () => {
      await account(userId, '銀行', AccountType.bank, 100000);
      outstanding = new Prisma.Decimal(999999); // 假 service 的值，這次不應該被用到
      const netWorth = await calc.getNetWorth(
        userId,
        TODAY,
        undefined,
        new Prisma.Decimal('30000.5'),
      );
      expect(s(netWorth)).toBe('69999.50');
      expect(getLoanSummary).not.toHaveBeenCalled();
    });

    it('傳入的 loanOutstanding 是 0：也不再查（沒有貸款不代表要重查）', async () => {
      await account(userId, '銀行', AccountType.bank, 100000);
      outstanding = new Prisma.Decimal(999999);
      const netWorth = await calc.getNetWorth(
        userId,
        TODAY,
        undefined,
        new Prisma.Decimal(0),
      );
      expect(s(netWorth)).toBe('100000.00');
      expect(getLoanSummary).not.toHaveBeenCalled();
    });

    it('月收支只算該月：上個月、下個月的交易都不算', async () => {
      const bank = await account(userId, '銀行', AccountType.bank, 0);
      await income(bank, '100', '2026-10-31');
      await income(bank, '200', '2026-11-01');
      await expense(bank, '50', '2026-11-20');
      await income(bank, '999', '2026-12-01');
      const m = await calc.getMonthlyTotals(userId, '2026-11', '2026-12-31');
      expect([s(m.income), s(m.expense)]).toEqual(['200.00', '50.00']);
    });

    it('小數金額不失精度', async () => {
      const bank = await account(userId, '銀行', AccountType.bank, 0.1);
      await income(bank, '0.2');
      await expense(bank, '0.05');
      expect(s(await calc.getAccountBalance(userId, bank, TODAY))).toBe('0.25');
    });
  });

  describe('使用者隔離', () => {
    it('別人的帳戶、交易都不會算進來', async () => {
      const other = await createUser(prisma, 'c-finance-other@example.com');
      const otherBank = await account(
        other,
        '別人的銀行',
        AccountType.bank,
        9999,
      );
      await createTransaction(prisma, {
        userId: other,
        accountId: otherBank,
        transactionType: TransactionType.income,
        amount: '1000',
        transactionDate: '2026-11-05',
        categoryId: salary,
      });
      await account(userId, '我的銀行', AccountType.bank, 100);

      expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('100.00');
      const m = await calc.getMonthlyTotals(userId, '2026-11', TODAY);
      expect(s(m.income)).toBe('0.00');
      expect(await calc.getAccountBalance(userId, otherBank, TODAY)).toBeNull();
    });

    it('沒有任何帳戶：合計、淨資產、可用現金都是 0', async () => {
      expect(s(await calc.getAccountsTotal(userId, TODAY))).toBe('0.00');
      expect(s(await calc.getNetWorth(userId, TODAY))).toBe('0.00');
      expect(await calc.getAvailableCash(userId, TODAY)).toMatchObject({
        hasCashAccounts: false,
      });
    });
  });
});
