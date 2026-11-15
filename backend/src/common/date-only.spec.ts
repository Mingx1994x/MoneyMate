import {
  addDays,
  addYears,
  dayInMonth,
  daysBetween,
  fromDbDate,
  isDateOnly,
  isMonthString,
  monthOf,
  monthStart,
  nextMonthStart,
  toDbDate,
} from './date-only.js';

describe('isDateOnly', () => {
  it.each(['2024-02-29', '2000-02-29', '1900-01-01', '2999-12-31'])(
    '%j 通過',
    (v) => {
      expect(isDateOnly(v)).toBe(true);
    },
  );

  it.each([
    ['非閏年 2/29', '2026-02-29'],
    ['2100 不是閏年', '2100-02-29'],
    ['2/30', '2026-02-30'],
    ['4/31', '2026-04-31'],
    ['13 月', '2026-13-01'],
    ['0 月', '2026-00-10'],
    ['0 日', '2026-12-00'],
    ['1900 年以前', '1899-12-31'],
    ['0000 年', '0000-01-01'],
    ['3000 年以後', '3000-01-01'],
    ['沒補 0', '2026-1-5'],
    ['結尾換行', '2026-01-05\n'],
    ['帶時間', '2026-01-05T00:00:00Z'],
    ['空字串', ''],
  ])('%s（%j）回 false 且不丟錯', (_, v) => {
    expect(() => isDateOnly(v)).not.toThrow();
    expect(isDateOnly(v)).toBe(false);
  });

  it.each([
    ['數字', 20260105],
    ['Date', new Date('2026-01-05T00:00:00Z')],
    ['null', null],
    ['undefined', undefined],
  ])('非字串（%s）回 false', (_, v) => {
    expect(isDateOnly(v)).toBe(false);
  });
});

describe('toDbDate／fromDbDate', () => {
  it('轉成 UTC 午夜，來回轉換後字串不變', () => {
    expect(toDbDate('2026-01-05').toISOString()).toBe(
      '2026-01-05T00:00:00.000Z',
    );
    for (const s of ['2026-01-05', '2024-02-29', '1900-01-01', '2999-12-31']) {
      expect(fromDbDate(toDbDate(s))).toBe(s);
    }
  });

  it('toDbDate 遇到不存在的日期丟錯，訊息不含輸入值', () => {
    expect(() => toDbDate('2026-02-30')).toThrow(Error);
    expect(() => toDbDate('2026-13-01')).toThrow(Error);
    let message = '';
    try {
      toDbDate('secret');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('secret');
  });

  it('fromDbDate 只接受 UTC 午夜（時間戳與 Invalid Date 丟錯）', () => {
    expect(() => fromDbDate(new Date('2026-01-05T16:00:00Z'))).toThrow(Error);
    expect(() => fromDbDate(new Date('invalid'))).toThrow(Error);
  });

  it('fromDbDate 對 1970 以前的日期也正確', () => {
    expect(fromDbDate(new Date('1960-06-15T00:00:00Z'))).toBe('1960-06-15');
    expect(() => fromDbDate(new Date('1960-06-15T12:00:00Z'))).toThrow(Error);
  });

  it('程序時區是 Asia/Taipei 時結果也一樣', () => {
    try {
      process.env.TZ = 'Asia/Taipei';
      // 先確認真的切換了（Vitest 用 threads pool 時改 TZ 不會生效）
      expect(new Date(0).getTimezoneOffset()).toBe(-480);
      expect(toDbDate('2026-01-05').toISOString()).toBe(
        '2026-01-05T00:00:00.000Z',
      );
      expect(fromDbDate(toDbDate('2026-01-05'))).toBe('2026-01-05');
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    } finally {
      // 不可用 delete：實測不會還原時區
      process.env.TZ = 'UTC';
    }
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });
});

describe('addDays', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-10-23', 14, '2026-11-06'],
    ['2026-10-23', 0, '2026-10-23'],
  ])('%s %+d 天 → %s', (d, n, expected) => {
    expect(addDays(d, n)).toBe(expected);
  });

  it('天數不是整數或日期不合法時丟錯', () => {
    expect(() => addDays('2026-01-01', 1.5)).toThrow(Error);
    expect(() => addDays('2026-02-30', 1)).toThrow(Error);
  });

  it.each([
    ['2999-12-31', 1],
    ['1900-01-01', -1],
    ['2026-01-01', 3e6],
    ['2026-01-01', 1e9],
  ])('結果超出 1900–2999 時丟錯（%s %+d 天）', (d, n) => {
    expect(() => addDays(d, n)).toThrow(/超出/);
  });
});

describe('monthOf／monthStart／nextMonthStart', () => {
  it('monthOf 取出 YYYY-MM', () => {
    expect(monthOf('2026-10-23')).toBe('2026-10');
    expect(() => monthOf('2026-02-30')).toThrow(Error);
  });

  it.each([
    ['2026-10', '2026-10-01', '2026-11-01'],
    ['2026-09', '2026-09-01', '2026-10-01'],
    ['2026-12', '2026-12-01', '2027-01-01'],
    ['2024-02', '2024-02-01', '2024-03-01'],
  ])('%s：%s 起、%s 前', (m, start, next) => {
    expect(monthStart(m)).toBe(start);
    expect(nextMonthStart(m)).toBe(next);
  });

  it.each(['2026-13', '2026-00', '2026-1', '2026-10-01', '1899-12', '2999-12'])(
    '不合法的月份（%j）丟錯，isMonthString 回 false',
    (m) => {
      expect(isMonthString(m)).toBe(false);
      expect(() => monthStart(m)).toThrow(Error);
      expect(() => nextMonthStart(m)).toThrow(Error);
    },
  );

  it('isMonthString：合法月份通過、非字串不通過', () => {
    expect(isMonthString('1900-01')).toBe(true);
    expect(isMonthString('2999-11')).toBe(true);
    expect(nextMonthStart('2999-11')).toBe('2999-12-01');
    expect(isMonthString(202610)).toBe(false);
    expect(isMonthString(null)).toBe(false);
  });
});

describe('dayInMonth', () => {
  it.each([
    ['2026-10', 5, '2026-10-05'],
    ['2026-10', 31, '2026-10-31'],
    ['2026-11', 31, '2026-11-30'],
    ['2026-02', 29, '2026-02-28'],
    ['2026-02', 31, '2026-02-28'],
    ['2024-02', 29, '2024-02-29'],
    ['2024-02', 30, '2024-02-29'],
    ['2026-12', 31, '2026-12-31'],
    ['2026-01', 1, '2026-01-01'],
  ])('%s 第 %i 天 → %s（短月用最後一天）', (m, day, expected) => {
    expect(dayInMonth(m, day)).toBe(expected);
  });

  it.each([0, 32, 1.5, -1, Number.NaN])(
    '日不是 1–31 的整數（%s）丟錯',
    (day) => {
      expect(() => dayInMonth('2026-10', day)).toThrow(Error);
    },
  );

  it('月份不合法時丟錯', () => {
    expect(() => dayInMonth('2026-13', 1)).toThrow(Error);
  });
});

describe('daysBetween', () => {
  it.each([
    ['2026-10-28', '2026-10-28', 0],
    ['2026-10-28', '2026-11-11', 14],
    ['2026-12-28', '2027-01-05', 8],
    ['2024-02-28', '2024-03-01', 2],
    ['2026-11-11', '2026-10-28', -14],
  ])('%s 到 %s 是 %i 天', (from, to, n) => {
    expect(daysBetween(from, to)).toBe(n);
  });

  it('日期不合法時丟錯', () => {
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(Error);
  });
});

describe('addYears', () => {
  it.each([
    ['2026-10-28', 50, '2076-10-28'],
    ['2024-02-29', 50, '2074-02-28'],
    ['2024-02-29', 4, '2028-02-29'],
    ['2026-10-28', -1, '2025-10-28'],
  ])('%s 加 %i 年是 %s', (d, n, expected) => {
    expect(addYears(d, n)).toBe(expected);
  });

  it.each([
    ['日期不合法', '2026-02-30', 1],
    ['年數不是整數', '2026-10-28', 1.5],
    ['結果超出 2999', '2990-01-01', 10],
  ])('%s時丟錯', (_label, d, n) => {
    expect(() => addYears(d, n)).toThrow(Error);
  });
});
