import { ClockService, toTaipeiDate } from './clock.service.js';

// 台北跨日的邊界：UTC 16:00 是台北的午夜
const CASES: [string, string][] = [
  ['2026-10-31T15:59:59.999Z', '2026-10-31'], // 台北 23:59:59.999，還是當天
  ['2026-10-31T16:00:00.000Z', '2026-11-01'], // 台北午夜，換日也換月
  ['2026-10-27T23:59:59Z', '2026-10-28'], // UTC 還是 27 號，台北已經是 28 號早上
  ['2026-12-31T16:00:00Z', '2027-01-01'], // 跨年
  ['2028-02-28T16:00:00Z', '2028-02-29'], // 閏日
];

const taipeiFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function viaIntl(instant: Date): string {
  const parts = Object.fromEntries(
    taipeiFormat.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

describe('toTaipeiDate', () => {
  it.each(CASES)('%s → %s', (iso, expected) => {
    expect(toTaipeiDate(new Date(iso))).toBe(expected);
  });

  it.each(CASES)('%s 跟 Intl 的 Asia/Taipei 結果相同', (iso) => {
    const instant = new Date(iso);
    expect(toTaipeiDate(instant)).toBe(viaIntl(instant));
  });

  it('Invalid Date 丟錯', () => {
    expect(() => toTaipeiDate(new Date('x'))).toThrow(
      'toTaipeiDate: Invalid Date',
    );
  });

  it.each([
    ['Asia/Taipei', -480],
    ['America/Los_Angeles', 480],
  ])('程序時區是 %s 時結果不變', (tz, offset) => {
    try {
      process.env.TZ = tz;
      // 先確認真的切換了（Vitest 用 threads pool 時改 TZ 不會生效）
      expect(new Date(0).getTimezoneOffset()).toBe(offset);
      for (const [iso, expected] of CASES) {
        expect(toTaipeiDate(new Date(iso))).toBe(expected);
      }
    } finally {
      // 不可用 delete：實測不會還原時區
      process.env.TZ = 'UTC';
    }
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });
});

describe('ClockService', () => {
  const clock = new ClockService();

  it('now() 是現在的時間', () => {
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('now() 每次回傳新的 Date', () => {
    const first = clock.now();
    first.setTime(0);
    expect(clock.now().getTime()).not.toBe(0);
  });

  it('today() 是 now() 的台北日期', () => {
    const service = new ClockService();
    vi.spyOn(service, 'now').mockReturnValue(new Date('2026-10-27T23:59:59Z'));
    expect(service.today()).toBe('2026-10-28');
  });
});
