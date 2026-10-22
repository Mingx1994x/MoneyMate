import { Controller, Get } from '@nestjs/common';

// 不加 /api/v1 前綴、不需登入。INF-7 會加上資料庫檢查（失敗回 503，不經全域 filter）。
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
