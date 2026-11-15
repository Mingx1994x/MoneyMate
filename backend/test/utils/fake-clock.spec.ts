import { ClockService } from '../../src/clock/clock.service.js';
import { FakeClock } from './fake-clock.js';

describe('FakeClock', () => {
  it('today() 依台北時間計算', () => {
    expect(new FakeClock('2026-10-31T16:00:00Z').today()).toBe('2026-11-01');
    expect(new FakeClock('2026-11-01T00:00:00+08:00').today()).toBe(
      '2026-11-01',
    );
  });

  it('onTaipeiDate 是台北該日中午', () => {
    const clock = FakeClock.onTaipeiDate('2026-10-28');
    expect(clock.today()).toBe('2026-10-28');
    expect(clock.now().toISOString()).toBe('2026-10-28T04:00:00.000Z');
  });

  it('set()、setTaipeiDate() 之後 now()、today() 都跟著變', () => {
    const clock = FakeClock.onTaipeiDate('2026-10-28');
    clock.set('2026-10-31T15:59:59Z');
    expect(clock.now().toISOString()).toBe('2026-10-31T15:59:59.000Z');
    expect(clock.today()).toBe('2026-10-31');

    clock.setTaipeiDate('2027-01-01');
    expect(clock.now().toISOString()).toBe('2027-01-01T04:00:00.000Z');
    expect(clock.today()).toBe('2027-01-01');
  });

  it('改 now() 回傳的 Date 不影響下一次', () => {
    const clock = FakeClock.onTaipeiDate('2026-10-28');
    clock.now().setTime(0);
    expect(clock.today()).toBe('2026-10-28');
  });

  it.each(['2026-10-28T12:00:00', '2026-10-28', 'abc', '2026-13-01T00:00:00Z'])(
    '%s（沒有時區或不是時間）丟錯',
    (iso) => {
      expect(() => new FakeClock(iso)).toThrow('FakeClock');
      expect(() => FakeClock.onTaipeiDate('2026-10-28').set(iso)).toThrow(
        'FakeClock',
      );
    },
  );

  it('不存在的日期丟錯', () => {
    expect(() => FakeClock.onTaipeiDate('2026-02-30')).toThrow('FakeClock');
    expect(() =>
      FakeClock.onTaipeiDate('2026-10-28').setTaipeiDate('2026-02-30'),
    ).toThrow('FakeClock');
  });

  it('可以當成 ClockService 注入', () => {
    expect(FakeClock.onTaipeiDate('2026-10-28')).toBeInstanceOf(ClockService);
  });
});
