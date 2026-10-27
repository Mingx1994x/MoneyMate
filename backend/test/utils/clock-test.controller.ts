import { Controller, Get } from '@nestjs/common';
import { ClockService } from '../../src/clock/clock.service.js';
import type { DateOnly } from '../../src/common/date-only.js';

// 只給 clock 的 e2e 用：回傳 ClockService 的今天（W1 還沒有業務端點用到今天）
@Controller('__clock-test')
export class ClockTestController {
  constructor(private readonly clock: ClockService) {}

  @Get()
  today(): { today: DateOnly } {
    return { today: this.clock.today() };
  }
}
