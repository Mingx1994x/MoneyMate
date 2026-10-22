import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { EnvVars } from '../config/env.validation.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * - 不帶泛型、不設全域 omit、不用 $extends：否則 PrismaClient 不能再指派給
 *   Prisma.TransactionClient，全組的 `tx: PrismaTx` 簽名會編譯失敗。
 * - 不在 onModuleInit 呼叫 $connect()：第一次查詢時才連線，資料庫斷線時 app 仍能啟動，
 *   /health 才能回 503，INF-2 也能在沒有資料庫時匯出 openapi.json。
 * - SSL 設定在 DEP-2 加入（骨架規格 4.4）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<EnvVars, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        max: config.get('DATABASE_POOL_MAX', { infer: true }),
        connectionTimeoutMillis: 5000,
      }),
      // 只留 warn：query 與 error 都會把查詢參數（Email、密碼雜湊）原文印到 stdout。
      // 錯誤本來就會丟給呼叫端，記錄方式交給 INF-3 的 filter。
      log: ['warn'],
      // 互動式交易預設只有 5 秒，帳單繳費一次要呼叫好幾個 service
      transactionOptions: { timeout: 10_000 },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
