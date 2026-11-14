import type { INestApplicationContext } from '@nestjs/common';
import { ClockService } from '../clock/clock.service.js';
import {
  addYears,
  monthOf,
  monthStart,
  type DateOnly,
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
 * 端到端（Playwright）測試用的固定帳號（PRD 20.5「端到端測試資料」）。
 * 每個帳號的資料照 PRD 的驗算案例建立，畫面上的數字是已知的，說明在 docs/e2e-fixtures.md。
 *
 * - 一律透過各模組的 service 建立，不直接寫資料表。
 * - 交易日期都是「本月 1 號」：不管哪一天跑，本月收支都一樣，而且不會是未來的交易。
 * - 安全界線：只會刪除、重建下面這 3 個 Email（users 會 CASCADE 到他們的資料），不會動其他使用者。
 *   Email 用 @moneymate.test（測試帳號規則，不會是真人的信箱）；密碼從環境變數 E2E_PASSWORD 傳入。
 * - AC-22 的房租本來是帳單，帳單繳費（E 的 #78）合併前先記成一般支出，金額一樣。
 */

/** 已註冊、還沒做問卷：登入後應該被帶到問卷頁 */
export const E2E_NEW_EMAIL = 'e2e-new@moneymate.test';
/** Dashboard 驗算案例（PRD 第二十七節 AC-22） */
export const E2E_DASHBOARD_EMAIL = 'e2e-dashboard@moneymate.test';
/** 目標驗算案例（AC-16） */
export const E2E_GOAL_EMAIL = 'e2e-goal@moneymate.test';

const EMAILS = [E2E_NEW_EMAIL, E2E_DASHBOARD_EMAIL, E2E_GOAL_EMAIL];

/** 密碼規則和註冊一樣（RegisterDto）：8 字元以上、UTF-8 不超過 72 bytes */
function assertPassword(password: string | undefined): string {
  if (
    !password ||
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error(
      'E2E_PASSWORD 沒有設定或不符合規則（8 字元以上、72 bytes 以內）',
    );
  }
  return password;
}

/**
 * 重建 3 個測試帳號，可以重複執行。先檢查密碼再刪資料：設定錯了不會把原本的帳號刪掉。
 * 不是包在同一個資料庫交易裡（各 service 會自己開交易）：中途失敗時再跑一次就會重建乾淨。
 */
export async function seedE2e(
  app: INestApplicationContext,
  password: string | undefined,
): Promise<void> {
  const pwd = assertPassword(password);
  const prisma = app.get(PrismaService);
  const today = app.get(ClockService).today();
  const firstDay = monthStart(monthOf(today));

  await prisma.$transaction((tx) => seedSystemCategories(tx));
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });

  const auth = app.get(AuthService);
  const goals = app.get(GoalsService);
  const accounts = app.get(AccountsService);
  const register = async (email: string, displayName: string) =>
    (await auth.register({ email, password: pwd, displayName })).user.id;
  const onboard = (userId: string) =>
    prisma.$transaction((tx) =>
      goals.createGoal(tx, userId, new Prisma.Decimal(40000)),
    );
  const account = async (
    userId: string,
    name: string,
    accountType: AccountType,
    openingBalance: string,
  ) =>
    (
      await accounts.create(
        userId,
        { name, accountType, openingBalance },
        today,
      )
    ).id;

  // ── e2e-new：只註冊
  await register(E2E_NEW_EMAIL, '新朋友');

  // ── e2e-goal（AC-16）：每月 4 萬；銀行 30 萬＋信用卡 −5 萬
  const goalUser = await register(E2E_GOAL_EMAIL, '目標測試');
  await onboard(goalUser);
  await account(goalUser, '銀行', AccountType.bank, '300000.00');
  await account(goalUser, '信用卡', AccountType.credit_card, '-50000.00');

  // ── e2e-dashboard（AC-22）：每月 4 萬；銀行 30 萬、信用卡 0、房貸 100 萬；本月 4 筆交易
  const userId = await register(E2E_DASHBOARD_EMAIL, 'Dashboard 測試');
  await onboard(userId);
  const bank = await account(userId, '銀行', AccountType.bank, '300000.00');
  const card = await account(userId, '信用卡', AccountType.credit_card, '0.00');
  await app.get(LoansService).create(userId, {
    name: '房貸',
    loanType: 'mortgage',
    outstandingBalance: '1000000.00',
    monthlyPayment: '17969.00',
    paymentDay: 15,
    endDate: addYears(today, 20),
  });

  const categories = Object.fromEntries(
    (
      await prisma.category.findMany({
        where: { userId: null },
        select: { code: true, id: true },
      })
    ).map((c) => [c.code, c.id]),
  );
  const transactions = app.get(TransactionsService);
  const add = (
    transactionType: TransactionType,
    amount: string,
    accountId: string,
    to: { categoryCode?: string; toAccountId?: string },
    note: string,
    date: DateOnly = firstDay,
  ) =>
    transactions.create(
      userId,
      {
        transactionType,
        amount,
        accountId,
        categoryId: to.categoryCode ? categories[to.categoryCode] : null,
        toAccountId: to.toAccountId ?? null,
        transactionDate: date,
        note,
      },
      today,
    );
  const { income, expense, transfer } = TransactionType;
  await add(income, '50000.00', bank, { categoryCode: 'salary' }, '薪資');
  await add(expense, '30000.00', card, { categoryCode: 'living' }, '生活');
  await add(expense, '80000.00', bank, { categoryCode: 'housing' }, '房租');
  await add(transfer, '10000.00', bank, { toAccountId: card }, '繳卡費');
}
