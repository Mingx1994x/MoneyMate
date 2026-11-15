import { Injectable } from '@nestjs/common';
import type { DateOnly } from '../common/date-only.js';

// 台灣 1979 年後沒有日光節約時間，固定 UTC+8（1980–2100 與 Intl 的 Asia/Taipei 逐時比對結果相同）
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 時間點 → 台北的日期，不受程序時區影響。
 * 給「把時間戳換成台北日期」用；要取得今天請用 ClockService.today()。
 */
export function toTaipeiDate(instant: Date): DateOnly {
  if (Number.isNaN(instant.getTime())) {
    throw new Error('toTaipeiDate: Invalid Date');
  }
  return new Date(instant.getTime() + TAIPEI_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * 全專案唯一可以讀系統時間的地方（no-direct-date.spec.ts 會擋其他地方）。
 * 測試用 test/utils/fake-clock.ts 的 FakeClock 替換。
 */
@Injectable()
export class ClockService {
  /** 現在的時間點。每次回傳新的 Date，呼叫端改它不影響別人。 */
  now(): Date {
    return new Date();
  }

  /** 台北的今天（YYYY-MM-DD）。一個請求只取一次，往下傳。 */
  today(): DateOnly {
    return toTaipeiDate(this.now());
  }
}
