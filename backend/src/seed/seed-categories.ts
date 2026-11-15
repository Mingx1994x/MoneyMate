// npm run seed:categories：建立或更新 12 個系統分類，可以重複執行。
// 連線設定、SSL 與環境變數驗證都和 app 一樣（用 AppModule 的 PrismaService），
// 所以連哪個資料庫由 DATABASE_URL 決定（本機讀 .env，是 app_dev）。
import '../tz.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/index.js';
import { seedSystemCategories } from './system-categories.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
  // 預設初始化失敗時會 process.abort()，看不到錯誤訊息
  abortOnError: false,
});
try {
  const prisma = app.get(PrismaService);
  const count = await prisma.$transaction((tx) => seedSystemCategories(tx));
  console.log(`seed:categories 完成：${count} 個系統分類`);
} finally {
  await app.close();
}
