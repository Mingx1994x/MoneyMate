// Prisma 7 不會自動讀 .env。dotenv 不覆蓋已存在的環境變數，
// 所以 CI 與 `dotenv run -f .env.test` 注入的值優先。
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // 不用 env()：變數不存在時 env() 連 `prisma generate` 都會失敗，
    // 而 CI、Docker 建置、第一次 npm ci 都沒有連線字串。缺少時只有 migrate 類指令會失敗。
    url: process.env.DIRECT_URL ?? '',
    // 只有 `db:drift`（`prisma migrate diff`）需要
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
