// npm run openapi:export：不需要資料庫、不讀 .env，輸出 openapi.json（前端用它產生型別）
import './export-env.js';
import '../tz.js';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { buildOpenApiDocument } from '../swagger.js';

const output = process.argv[2] ?? 'openapi.json';

const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: ['error', 'warn'],
  // 預設初始化失敗時會 process.abort()，看不到錯誤訊息
  abortOnError: false,
});
// 全域前綴靠 configureApp 設定，文件的路徑才會帶 /api/v1；不呼叫 listen
configureApp(app);
writeFileSync(
  output,
  `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`,
);
await app.close();
console.log(`openapi:export 已輸出 ${output}`);
