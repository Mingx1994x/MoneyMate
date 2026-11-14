// npm run seed:demo：重建 Demo 帳號（PRD 第二十八節、Issue #33），可以重複執行。
// 連哪個資料庫由 DATABASE_URL 決定（本機讀 .env，是 app_dev）；密碼讀 DEMO_PASSWORD。
// 只會刪除、重建 demo@moneymate.local 與 demo-new@moneymate.local，不會動其他使用者。
import '../tz.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { DEMO_EMAIL, DEMO_NEW_EMAIL, seedDemo } from './demo-data.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
  // 預設初始化失敗時會 process.abort()，看不到錯誤訊息
  abortOnError: false,
});
try {
  // ConfigModule 建立時已經把 .env 讀進 process.env
  const result = await seedDemo(app, process.env.DEMO_PASSWORD);
  console.log(
    `seed:demo 完成：${DEMO_EMAIL}（${result.transactions} 筆交易）、${DEMO_NEW_EMAIL}（還沒做問卷）`,
  );
} finally {
  await app.close();
}
