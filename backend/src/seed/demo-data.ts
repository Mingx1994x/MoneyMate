import type { INestApplicationContext } from '@nestjs/common';
import { ClockService, toTaipeiDate } from '../clock/clock.service.js';
import {
  addDays,
  addYears,
  dayInMonth,
  monthOf,
  monthStart,
  type DateOnly,
  type MonthString,
} from '../common/date-only.js';
import { AccountsService } from '../modules/accounts/index.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { GoalsService } from '../modules/goals/index.js';
import { LoansService } from '../modules/loans/index.js';
import { TransactionsService } from '../modules/transactions/index.js';
import {
  AccountType,
  Prisma,
  PrismaService,
  TransactionType,
} from '../prisma/index.js';
import { seedSystemCategories } from './system-categories.js';

/**
 * Demo 資料（PRD 第二十八節、Issue #33）。一律透過各模組的 service 建立，不直接寫資料表；
 * 日期都從「今天」往回算，所以哪一天重建，畫面看起來都是最近 12 個月。
 *
 * 安全界線：只會刪除、重建下面這 2 個 Email 的使用者（users 會 CASCADE 到他們的資料），
 * 不會動其他使用者。Email 用 .local（不會是真人的信箱）；密碼由呼叫端從環境變數 DEMO_PASSWORD 傳入。
 *
 * 還沒做：帳單（等 E 的繳費功能合併）。估計帳戶依 D-D-004 不再建立。
 */

/** Demo 帳號：已完成問卷、有 12 個月的資料 */
export const DEMO_EMAIL = 'demo@moneymate.local';
/** 「新帳號」：還沒做問卷，現場示範 30 秒問卷用 */
export const DEMO_NEW_EMAIL = 'demo-new@moneymate.local';

/** 最近幾個完整月的交易（再加上本月到今天） */
const MONTHS = 12;
/** 房貸的未償餘額是幾天前更新的（超過 30 天會提醒更新） */
const LOAN_UPDATED_DAYS_AGO = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DemoSeedResult {
  demoUserId: string;
  newUserId: string;
  transactions: number;
}

/** 密碼規則和註冊一樣（RegisterDto）：8 字元以上、UTF-8 不超過 72 bytes */
function assertPassword(password: string | undefined): string {
  if (
    !password ||
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error(
      'DEMO_PASSWORD 沒有設定或不符合規則（8 字元以上、72 bytes 以內）',
    );
  }
  return password;
}

/**
 * 重建 2 個 Demo 使用者與資料，可以重複執行。
 * 先檢查密碼再刪資料：設定錯了不會把原本的 Demo 資料刪掉。
 * 不是包在同一個資料庫交易裡（各 service 會自己開交易）：中途失敗時再跑一次就會重建乾淨。
 */
export async function seedDemo(
  app: INestApplicationContext,
  password: string | undefined,
): Promise<DemoSeedResult> {
  const pwd = assertPassword(password);
  const prisma = app.get(PrismaService);
  const clock = app.get(ClockService);
  const today = clock.today();

  await prisma.$transaction((tx) => seedSystemCategories(tx));
  await prisma.user.deleteMany({
    where: { email: { in: [DEMO_EMAIL, DEMO_NEW_EMAIL] } },
  });

  const auth = app.get(AuthService);
  const demo = await auth.register({
    email: DEMO_EMAIL,
    password: pwd,
    displayName: 'Demo',
  });
  const fresh = await auth.register({
    email: DEMO_NEW_EMAIL,
    password: pwd,
    displayName: '新朋友',
  });
  const userId = demo.user.id;

  // ── 問卷：每月 4 萬 → 目標 1,200 萬；補上出生年，目標頁才算得出財富自由年齡
  const goals = app.get(GoalsService);
  await prisma.$transaction((tx) =>
    goals.createGoal(tx, userId, new Prisma.Decimal(40000)),
  );
  await goals.update(userId, { birthYear: 1992 }, today);

  // ── 4 個帳戶
  const accountsService = app.get(AccountsService);
  const account = async (
    name: string,
    accountType: AccountType,
    openingBalance: string,
  ): Promise<string> =>
    (
      await accountsService.create(
        userId,
        { name, accountType, openingBalance },
        today,
      )
    ).id;
  const cash = await account('錢包', AccountType.cash, '3000.00');
  const bank = await account('薪轉戶', AccountType.bank, '180000.00');
  const invest = await account('ETF 投資', AccountType.investment, '300000.00');
  const card = await account('信用卡', AccountType.credit_card, '0.00');

  // ── 房貸：用晚 60 天的時鐘建立，未償餘額就是 60 天前更新的（PRD 第二十八節「觸發提醒」）
  const loanClock = shiftedClock(clock, -LOAN_UPDATED_DAYS_AGO);
  const loans = new LoansService(prisma, loanClock);
  await loans.create(userId, {
    name: '房貸',
    loanType: 'mortgage',
    outstandingBalance: '3200000.00',
    monthlyPayment: '17969.00',
    paymentDay: 15,
    endDate: addYears(loanClock.today(), 20),
    interestRate: 2.1,
  });

  // ── 交易：最近 12 個完整月＋本月到今天
  const categories = Object.fromEntries(
    (
      await prisma.category.findMany({
        where: { userId: null },
        select: { code: true, id: true },
      })
    ).map((c) => [c.code, c.id]),
  );
  const transactions = app.get(TransactionsService);
  let count = 0;
  const add = async (
    month: MonthString,
    day: number,
    transactionType: TransactionType,
    amount: number,
    from: string,
    to: { categoryCode?: string; toAccountId?: string },
    note?: string,
  ): Promise<void> => {
    const transactionDate = dayInMonth(month, day);
    if (transactionDate > today) return; // 不建未來的交易
    await transactions.create(
      userId,
      {
        transactionType,
        amount: amount.toFixed(2),
        accountId: from,
        categoryId: to.categoryCode ? categories[to.categoryCode] : null,
        toAccountId: to.toAccountId ?? null,
        transactionDate,
        note: note ?? null,
      },
      today,
    );
    count++;
  };

  const { income, expense, transfer } = TransactionType;
  const months = monthsUpTo(today, MONTHS);
  let lastCardSpend = 0;
  for (const [i, month] of months.entries()) {
    // 讓每個月的數字有一點變化，圖表才不會是一條直線
    const food = 6000 + (i % 4) * 600;
    const living = 3200 + (i % 3) * 450;
    const subscription = 390;
    const cardSpend = food + living + subscription;

    await add(month, 3, transfer, 2000, bank, { toAccountId: cash }, '提款');
    await add(
      month,
      5,
      income,
      52000,
      bank,
      { categoryCode: 'salary' },
      '薪水',
    );
    await add(
      month,
      6,
      transfer,
      5000,
      bank,
      { toAccountId: invest },
      '定期定額',
    );
    await add(month, 8, expense, food, card, { categoryCode: 'food' }, '餐費');
    if (lastCardSpend > 0) {
      await add(
        month,
        10,
        transfer,
        lastCardSpend,
        bank,
        { toAccountId: card },
        '繳卡費',
      );
    }
    await add(
      month,
      12,
      expense,
      1200,
      cash,
      { categoryCode: 'transport' },
      '交通',
    );
    await add(
      month,
      15,
      expense,
      17969,
      bank,
      { categoryCode: 'loan_payment' },
      '房貸',
    );
    await add(
      month,
      20,
      expense,
      living,
      card,
      { categoryCode: 'living' },
      '日用品',
    );
    await add(
      month,
      25,
      expense,
      subscription,
      card,
      { categoryCode: 'subscription' },
      '影音訂閱',
    );
    if (i % 3 === 2) {
      await add(
        month,
        28,
        income,
        1800,
        invest,
        { categoryCode: 'investment_income' },
        '股利',
      );
    }
    lastCardSpend = cardSpend;
  }

  return {
    demoUserId: userId,
    newUserId: fresh.user.id,
    transactions: count,
  };
}

/** 從 n 個月前到本月（含），由舊到新；例：2026-11-11、2 → 2026-09、2026-10、2026-11 */
function monthsUpTo(today: DateOnly, n: number): MonthString[] {
  const months: MonthString[] = [monthOf(today)];
  for (let i = 0; i < n; i++) {
    months.unshift(monthOf(addDays(monthStart(months[0]), -1)));
  }
  return months;
}

/** 比真的時鐘快（正數）或慢（負數）幾天的時鐘，只給 seed 建「過去的」資料用 */
function shiftedClock(base: ClockService, days: number): ClockService {
  return new (class extends ClockService {
    override now(): Date {
      return new Date(base.now().getTime() + days * DAY_MS);
    }
    override today(): DateOnly {
      return toTaipeiDate(this.now());
    }
  })();
}
