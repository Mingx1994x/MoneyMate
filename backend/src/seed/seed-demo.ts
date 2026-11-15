// npm run seed:demo：刪掉並重建 Demo 帳號（PRD 第二十八節），可以重複執行。
// 和 seed:categories 一樣用 AppModule 的設定與 service，所以連哪個資料庫由 DATABASE_URL 決定。
// 密碼從 DEMO_PASSWORD 讀取（8–72 bytes），不寫在程式碼裡；兩個 Demo 帳號共用。
import '../tz.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ClockService } from '../clock/clock.service.js';
import { AccountsService } from '../modules/accounts/index.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { BillsService } from '../modules/bills/index.js';
import { LoansService } from '../modules/loans/index.js';
import { OnboardingService } from '../modules/onboarding/onboarding.service.js';
import { TransactionsService } from '../modules/transactions/index.js';
import { PrismaService } from '../prisma/index.js';
import { DEMO_EMAIL, DEMO_NEW_EMAIL, seedDemo } from './demo-data.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
  // 預設初始化失敗時會 process.abort()，看不到錯誤訊息
  abortOnError: false,
});
try {
  // AppModule 的 ConfigModule 會讀 .env，所以 DEMO_PASSWORD 可以寫在 .env
  const password = process.env.DEMO_PASSWORD ?? '';
  const bytes = Buffer.byteLength(password, 'utf8');
  if (password.length < 8 || bytes > 72) {
    throw new Error(
      'seed:demo：請設定 DEMO_PASSWORD（8–72 字元，最多 72 bytes）',
    );
  }
  const result = await seedDemo(
    {
      prisma: app.get(PrismaService),
      clock: app.get(ClockService),
      auth: app.get(AuthService),
      onboarding: app.get(OnboardingService),
      accounts: app.get(AccountsService),
      transactions: app.get(TransactionsService),
      loans: app.get(LoansService),
      bills: app.get(BillsService),
    },
    password,
  );
  console.log(
    `seed:demo 完成：${DEMO_EMAIL}（${result.accounts} 個帳戶、${result.transactions} 筆交易、` +
      `${result.loans} 筆貸款、${result.bills} 張帳單）、${DEMO_NEW_EMAIL}（未填問卷）`,
  );
} finally {
  await app.close();
}
