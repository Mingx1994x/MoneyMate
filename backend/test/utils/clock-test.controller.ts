import { Controller, Get } from '@nestjs/common';
import { ClockService } from '../../src/clock/clock.service.js';
import type { DateOnly } from '../../src/common/date-only.js';
import { Public } from '../../src/modules/auth/index.js';

// 只給 clock 的 e2e 用：回傳 ClockService 的今天（W1 還沒有業務端點用到今天）。
// 測的不是登入，所以設成公開（全域 JWT guard 之後預設每個端點都要 token）
@Public()
@Controller('__clock-test')
export class ClockTestController {
  constructor(private readonly clock: ClockService) {}

  @Get()
  today(): { today: DateOnly } {
    return { today: this.clock.today() };
  }
}
