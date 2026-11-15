import type { ClockService } from '../clock/clock.service.js';
import {
  addDays,
  addYears,
  dayInMonth,
  monthOf,
  type DateOnly,
  type MonthString,
} from '../common/date-only.js';
import {
  AccountType,
  Recurrence,
  TransactionType,
  type PrismaService,
} from '../prisma/index.js';
import type { AccountsService } from '../modules/accounts/index.js';
import type { AuthService } from '../modules/auth/auth.service.js';
import type { BillsService } from '../modules/bills/index.js';
import { LoanType } from '../modules/loans/dto/loan-type.enum.js';
import type { LoansService } from '../modules/loans/index.js';
import type { OnboardingService } from '../modules/onboarding/onboarding.service.js';
import type { TransactionsService } from '../modules/transactions/index.js';
import { seedSystemCategories } from './system-categories.js';

/**
 * Demo 帳號（PRD 第二十八節）。⚠️ 內容是暫定的假資料，等 C 確認 Demo 劇本後再調整。
 * - 全部虛構：不使用真實姓名、銀行帳號或個人財務資料。
 * - 只會刪除、重建下面兩個 Email 的資料，不動其他使用者。
 */
export const DEMO_EMAIL = 'demo@moneymate.local';
/** 「新帳號」：只註冊、沒有問卷，現場示範 30 秒問卷用 */
export const DEMO_NEW_EMAIL = 'demo-new@moneymate.local';
export const DEMO_EMAILS = [DEMO_EMAIL, DEMO_NEW_EMAIL] as const;

/** 12 個月的 Demo 資料（含本月，本月只到今天） */
export const DEMO_MONTHS = 12;

const DAY_MS = 86_400_000;

/** seed 用到的 service（從 Nest 的 app context 取得，測試也用同一套） */
export interface DemoSeedDeps {
  prisma: PrismaService;
  clock: ClockService;
  auth: AuthService;
  onboarding: OnboardingService;
  accounts: AccountsService;
  transactions: TransactionsService;
  loans: LoansService;
  bills: BillsService;
}

export interface DemoSeedResult {
  demoUserId: string;
  newUserId: string;
  accounts: number;
  transactions: number;
  loans: number;
  bills: number;
}

/**
 * 刪掉兩個 Demo 帳號與他們的所有資料（同一個資料庫交易）。
 * 業務資料之間是 Restrict，所以照「交易 → 帳單、貸款、目標 → 帳戶、自訂分類 → 使用者」的順序刪，
 * 不依賴 users 的 CASCADE 順序。回傳刪掉的使用者數。
 */
export async function removeDemoUsers(prisma: PrismaService): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { email: { in: [...DEMO_EMAILS] } },
      select: { id: true },
    });
    if (users.length === 0) return 0;
    const userId = { in: users.map((u) => u.id) };
    await tx.transaction.deleteMany({ where: { userId } });
    await tx.bill.deleteMany({ where: { userId } });
    await tx.loan.deleteMany({ where: { userId } });
    await tx.goal.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.category.deleteMany({ where: { userId } });
    const { count } = await tx.user.deleteMany({ where: { id: userId } });
    return count;
  });
}

/**
 * 重建 Demo 資料，可以重複執行：先刪掉兩個 Demo 帳號，再全部透過 service 建立（PRD 第二十八節）。
 * 不是一個資料庫交易（各 service 自己開交易）：中途失敗時再跑一次就會從頭重建。
 * 唯一直接寫資料表的是房貸的 balanceUpdatedAt（service 一律設成現在，Demo 需要 60 天前）。
 */
export async function seedDemo(
  deps: DemoSeedDeps,
  password: string,
): Promise<DemoSeedResult> {
  const { prisma, clock } = deps;
  const today = clock.today();

  await prisma.$transaction((tx) => seedSystemCategories(tx));
  const categories = await loadCategoryIds(prisma);
  await removeDemoUsers(prisma);

  // 1. 兩個帳號都走註冊流程（密碼雜湊、Email 正規化和真的註冊一樣）
  const demo = await deps.auth.register({
    email: DEMO_EMAIL,
    password,
    displayName: 'Demo 小明',
  });
  const fresh = await deps.auth.register({
    email: DEMO_NEW_EMAIL,
    password,
    displayName: '新朋友',
  });
  const userId = demo.user.id;

  // 2. 問卷：每月 4 萬、現有資產 80 萬 → 目標 1,200 萬＋估計帳戶
  await deps.onboarding.submit(userId, {
    monthlySpending: 40000,
    currentAssets: 800000,
  });

  // 3. 4 個帳戶；銀行帳戶從估計帳戶轉換（扣掉 12 萬）
  const cash = await deps.accounts.create(
    userId,
    { name: '錢包', accountType: AccountType.cash, openingBalance: '5000' },
    today,
  );
  const bank = await deps.accounts.create(
    userId,
    {
      name: '示範銀行',
      accountType: AccountType.bank,
      openingBalance: '120000',
      deductFromEstimate: true,
      note: '薪轉戶（虛構）',
    },
    today,
  );
  const invest = await deps.accounts.create(
    userId,
    {
      name: '示範證券',
      accountType: AccountType.investment,
      openingBalance: '300000',
    },
    today,
  );
  const card = await deps.accounts.create(
    userId,
    {
      name: '示範信用卡',
      accountType: AccountType.credit_card,
      openingBalance: '0',
    },
    today,
  );

  // 4. 12 個月的交易
  const ids = {
    cash: cash.id,
    bank: bank.id,
    invest: invest.id,
    card: card.id,
  };
  const planned = planTransactions(today, ids, categories);
  for (const t of planned) {
    await deps.transactions.create(userId, t, today);
  }

  // 5. 房貸：餘額 60 天前更新，觸發「該更新一下了」的提醒
  const loan = await deps.loans.create(userId, {
    name: '示範房貸',
    loanType: LoanType.mortgage,
    outstandingBalance: '3600000',
    monthlyPayment: '18000',
    paymentDay: 10,
    endDate: dayInMonth(monthOf(addYears(today, 20)), 10),
    interestRate: 2.1,
  });
  await prisma.loan.update({
    where: { id: loan.id },
    data: {
      balanceUpdatedAt: new Date(clock.now().getTime() - 60 * DAY_MS),
    },
  });

  // 6. 帳單：1 張逾期、1 張 14 天內到期、1 張每月重複且已繳 3 期
  await deps.bills.create(userId, {
    name: '水費',
    amount: '420',
    categoryId: categories.living,
    accountId: bank.id,
    dueDate: addDays(today, -5),
  });
  await deps.bills.create(userId, {
    name: '網路費',
    amount: '1099',
    categoryId: categories.subscription,
    accountId: bank.id,
    dueDate: addDays(today, 7),
    recurrence: Recurrence.monthly,
  });
  let phone = await deps.bills.create(userId, {
    name: '手機月租',
    amount: '599',
    categoryId: categories.subscription,
    accountId: card.id,
    dueDate: recurringStart(today),
    recurrence: Recurrence.monthly,
  });
  for (let i = 0; i < 3; i++) {
    const { nextBill } = await deps.bills.pay(userId, phone.id, {
      paidDate: addDays(phone.dueDate, -2),
    });
    if (nextBill === null) throw new Error('seedDemo: 每月帳單沒有產生下一期');
    phone = nextBill;
  }

  const bills = await prisma.bill.count({ where: { userId } });
  const accounts = await prisma.account.count({ where: { userId } });
  const transactions = await prisma.transaction.count({ where: { userId } });
  return {
    demoUserId: userId,
    newUserId: fresh.user.id,
    accounts,
    transactions,
    loans: 1,
    bills,
  };
}

type CategoryIds = Record<
  | 'salary'
  | 'investment_income'
  | 'food'
  | 'transport'
  | 'living'
  | 'housing'
  | 'loan_payment'
  | 'insurance'
  | 'tax'
  | 'subscription',
  string
>;

async function loadCategoryIds(prisma: PrismaService): Promise<CategoryIds> {
  const rows = await prisma.category.findMany({
    where: { userId: null },
    select: { code: true, id: true },
  });
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const get = (code: keyof CategoryIds): string => {
    const id = byCode.get(code);
    if (id === undefined) throw new Error(`seedDemo: 找不到系統分類 ${code}`);
    return id;
  };
  return {
    salary: get('salary'),
    investment_income: get('investment_income'),
    food: get('food'),
    transport: get('transport'),
    living: get('living'),
    housing: get('housing'),
    loan_payment: get('loan_payment'),
    insurance: get('insurance'),
    tax: get('tax'),
    subscription: get('subscription'),
  };
}

/** m 往前或往後 n 個月 */
function shiftMonth(m: MonthString, n: number): MonthString {
  const total = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  const year = Math.floor(total / 12);
  return `${year}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * 每月帳單第 1 期的到期日：3 個月前、日期是「今天加 20 天」的那一天（最多 28 號，短月不會被截掉）。
 * 繳 3 期後，第 4 期在 14 天之後到期，不會跟「14 天內到期」那張帳單混在一起。
 */
export function recurringStart(today: DateOnly): DateOnly {
  const target = addDays(today, 20);
  const day = Math.min(Number(target.slice(8, 10)), 28);
  return dayInMonth(shiftMonth(monthOf(target), -3), day);
}

interface PlannedTransaction {
  transactionType: TransactionType;
  amount: string;
  accountId: string;
  categoryId?: string;
  toAccountId?: string;
  transactionDate: DateOnly;
  note: string;
}

/**
 * 12 個月（含本月）的收入、支出、轉帳；不晚於今天的才建立。金額用固定公式變化，每次重建結果相同。
 * 信用卡的消費在下個月 20 號從銀行轉帳繳清（繳卡費）。
 */
export function planTransactions(
  today: DateOnly,
  acc: { cash: string; bank: string; invest: string; card: string },
  cat: CategoryIds,
): PlannedTransaction[] {
  const out: PlannedTransaction[] = [];
  const current = monthOf(today);
  let lastCardSpending = 0;

  for (let i = DEMO_MONTHS - 1; i >= 0; i--) {
    const m = shiftMonth(current, -i);
    const month = Number(m.slice(5, 7));
    const vary = (base: number, step: number): number =>
      base + ((i * 37 + month * 11) % 7) * step;
    const at = (day: number): DateOnly => dayInMonth(m, day);
    const expense = (
      day: number,
      amount: number,
      accountId: string,
      categoryId: string,
      note: string,
    ): void => {
      out.push({
        transactionType: TransactionType.expense,
        amount: String(amount),
        accountId,
        categoryId,
        transactionDate: at(day),
        note,
      });
    };
    const income = (
      day: number,
      amount: number,
      accountId: string,
      categoryId: string,
      note: string,
    ): void => {
      out.push({
        transactionType: TransactionType.income,
        amount: String(amount),
        accountId,
        categoryId,
        transactionDate: at(day),
        note,
      });
    };
    const transfer = (
      day: number,
      amount: number,
      from: string,
      to: string,
      note: string,
    ): void => {
      out.push({
        transactionType: TransactionType.transfer,
        amount: String(amount),
        accountId: from,
        toAccountId: to,
        transactionDate: at(day),
        note,
      });
    };

    expense(1, 2000, acc.bank, cat.housing, '社區管理費');
    transfer(2, 3000, acc.bank, acc.cash, 'ATM 提款');
    expense(3, vary(280, 40), acc.cash, cat.food, '早餐');
    income(5, 52000, acc.bank, cat.salary, '薪資');
    if (month === 1) income(5, 52000, acc.bank, cat.salary, '年終獎金');
    transfer(6, 10000, acc.bank, acc.invest, '定期定額');
    expense(8, 1200, acc.card, cat.transport, '通勤月票');
    expense(10, 18000, acc.bank, cat.loan_payment, '房貸');
    const grocery = vary(1800, 150);
    expense(11, grocery, acc.card, cat.food, '超市');
    const daily = vary(1200, 120);
    expense(15, daily, acc.card, cat.living, '日用品');
    expense(19, vary(450, 60), acc.cash, cat.food, '午餐');
    if (lastCardSpending > 0) {
      transfer(20, lastCardSpending, acc.bank, acc.card, '繳卡費');
    }
    const dinner = vary(1600, 200);
    expense(26, dinner, acc.card, cat.food, '聚餐');
    if (month % 3 === 0) {
      income(25, 3600, acc.invest, cat.investment_income, '股利');
    }
    if (month === 5) expense(31, 8500, acc.bank, cat.tax, '綜合所得稅');
    if (month === 7) expense(15, 12000, acc.bank, cat.insurance, '年繳保險');

    // 手機月租（每月帳單）繳費時另外刷卡，不算在這裡
    lastCardSpending = 1200 + grocery + daily + dinner;
  }

  return out
    .filter((t) => t.transactionDate <= today)
    .sort((a, b) => (a.transactionDate < b.transactionDate ? -1 : 1));
}
