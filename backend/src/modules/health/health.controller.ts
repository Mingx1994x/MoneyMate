import { Controller, Get, Logger, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  describeError,
  isDatabaseError,
} from '../../common/errors/all-exceptions.filter.js';
import { PrismaService } from '../../prisma/index.js';

// Render 每次健康檢查的逾時是 5 秒，2 秒夠用
const DB_CHECK_TIMEOUT_MS = 2000;

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: 'ok' | 'error';

  @ApiProperty({ enum: ['ok', 'down'], example: 'ok' })
  db!: 'ok' | 'down';
}

// 不加 /api/v1 前綴、不需登入。每次請求都真的查一次資料庫，不快取結果。
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger('HealthController');

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '確認服務與資料庫正常' })
  @ApiOkResponse({ type: HealthResponseDto })
  // 與 200 共用 DTO，DTO 欄位的 example 是 ok，503 要另外指定範例，否則 Swagger 會顯示 ok／ok
  @ApiServiceUnavailableResponse({
    type: HealthResponseDto,
    description: '資料庫連不到或逾時',
    example: { status: 'error', db: 'down' },
  })
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthResponseDto> {
    if (await this.checkDb()) {
      return { status: 'ok', db: 'ok' };
    }
    // 503 不拋例外：直接設定狀態碼回傳，不經全域 filter（body 沒有 code、requestId）
    res.status(503);
    return { status: 'error', db: 'down' };
  }

  /**
   * - 直接 race 原本的查詢，不要先 .catch()：那樣立刻失敗時 race 會拿到 undefined 而回 200。
   *   逾時後查詢才失敗也不會變成 unhandled rejection（race 對每個輸入都掛了處理函式）。
   * - 逾時後查詢仍在背景執行：卡在建立連線時最晚 5 秒（connectionTimeoutMillis）自己失敗；
   *   連上之後卡住則沒有逾時，W2 再評估 statement_timeout。
   * - adapter-pg 的連線失敗多半是 PrismaClientKnownRequestError P2010，要看 kind 才分得出原因
   *   （Prisma 7.10.1 實測）：憑證不對 TlsConnectionError；Supabase 帳號不存在
   *   postgres／causeCode XX000；主機不存在 DatabaseNotReachable。
   *   例外：資料庫拒絕連線時 code 是 ECONNREFUSED、沒有 kind；連線池取不到連線是一般的 Error。
   */
  private async checkDb(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), DB_CHECK_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        timeout,
      ]);
      if (result === 'timeout') {
        this.logger.warn(`資料庫檢查逾時（${DB_CHECK_TIMEOUT_MS}ms）`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`資料庫檢查失敗：${summarize(error)}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

// message 與 stack 可能帶 Supabase 的使用者名稱或 IP：資料庫錯誤只記結構化欄位，其他錯誤只記名稱
function summarize(error: unknown): string {
  if (isDatabaseError(error)) return describeError(error);
  return error instanceof Error ? error.name : typeof error;
}
