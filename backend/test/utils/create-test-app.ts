import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

/**
 * 所有 e2e 一律透過這個函式建 app，確保和正式環境走同一個 configureApp。
 * - override：替換 provider，例如固定 ClockService 的今天（INF-6）。
 * - controllers：只給測試用的 controller（例如丟出特定例外，測 filter 的行為）。
 * - 需要登入的端點用 test-token.ts 的 bearer(app) 帶 token。
 * - C 在 W2 於同一個資料夾加 reset-db.ts（清資料）與 auth.ts（真的註冊、登入的 helper）。
 */
export async function createTestApp(opts?: {
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  controllers?: Type[];
}): Promise<INestApplication<App>> {
  assertTestDatabase();

  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: opts?.controllers ?? [],
  });
  if (opts?.override) builder = opts.override(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

// AppModule 被 import 時，ConfigModule 已經把 .env.test 寫進 process.env，所以這裡讀得到。
// 錯誤訊息不印出連線字串。
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  const databaseName = url ? new URL(url).pathname.replace(/^\//, '') : '';
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      'createTestApp 只能連 *_test 資料庫：目前的 DATABASE_URL 不是（請檢查 .env.test）',
    );
  }
}
