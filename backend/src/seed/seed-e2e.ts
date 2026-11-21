// npm run seed:e2e：重建端到端（Playwright）測試用的 3 個帳號，可以重複執行（說明在 docs/e2e-fixtures.md）。
// 連哪個資料庫由 DATABASE_URL 決定（本機讀 .env，是 app_dev）；密碼讀 E2E_PASSWORD。
// 只會刪除、重建 e2e-new、e2e-dashboard、e2e-goal 這 3 個 @moneymate.test 帳號，不會動其他使用者。
import '../tz.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import {
  E2E_DASHBOARD_EMAIL,
  E2E_GOAL_EMAIL,
  E2E_NEW_EMAIL,
  seedE2e,
} from './e2e-fixtures.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
  // 預設初始化失敗時會 process.abort()，看不到錯誤訊息
  abortOnError: false,
});
try {
  // ConfigModule 建立時已經把 .env 讀進 process.env
  await seedE2e(app, process.env.E2E_PASSWORD);
  console.log(
    `seed:e2e 完成：${E2E_NEW_EMAIL}、${E2E_DASHBOARD_EMAIL}、${E2E_GOAL_EMAIL}`,
  );
} finally {
  await app.close();
}
