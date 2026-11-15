import { ClockService } from '../../src/clock/clock.service.js';
import { isDateOnly, type DateOnly } from '../../src/common/date-only.js';

// 沒有時區的字串會被當成程序的本地時間，本機（台北）與 CI（UTC）結果不同，所以一律要求帶時區
const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

/**
 * 測試用的時鐘：只覆寫 now()，today() 沿用 ClockService，跟正式程式用同一條算法。
 * - 單元測試：new XxxService(prismaMock, FakeClock.onTaipeiDate('2026-10-28'))
 * - e2e：createTestApp({ override: (b) => b.overrideProvider(ClockService).useValue(clock) })
 */
export class FakeClock extends ClockService {
  private instant: Date;

  /** iso 必須帶 Z 或 ±hh:mm，例如 '2026-10-31T16:00:00Z'。 */
  constructor(iso: string) {
    super();
    this.instant = parseInstant(iso);
  }

  /** 台北該日 12:00（離兩邊的午夜都遠）。只在意「今天是哪天」時用這個。 */
  static onTaipeiDate(d: DateOnly): FakeClock {
    return new FakeClock(taipeiNoon(d));
  }

  set(iso: string): void {
    this.instant = parseInstant(iso);
  }

  setTaipeiDate(d: DateOnly): void {
    this.instant = parseInstant(taipeiNoon(d));
  }

  override now(): Date {
    return new Date(this.instant.getTime());
  }
}

function parseInstant(iso: string): Date {
  const d = new Date(iso);
  if (!HAS_OFFSET.test(iso) || Number.isNaN(d.getTime())) {
    throw new Error(
      `FakeClock: 時間要寫成帶時區的 ISO 字串（例如 2026-10-31T16:00:00Z），收到 ${iso}`,
    );
  }
  return d;
}

function taipeiNoon(d: DateOnly): string {
  if (!isDateOnly(d)) {
    throw new Error('FakeClock: 日期要是存在的 YYYY-MM-DD');
  }
  return `${d}T12:00:00+08:00`;
}
