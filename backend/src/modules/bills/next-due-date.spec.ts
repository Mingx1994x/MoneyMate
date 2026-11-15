import { Recurrence } from '../../prisma/index.js';
import { nextDueDate, type DueDateRule } from './next-due-date.js';

const monthly = (dueDate: string, dueDay: number): DueDateRule => ({
  dueDate,
  dueDay,
  dueMonth: null,
  recurrence: Recurrence.monthly,
});

const yearly = (
  dueDate: string,
  dueMonth: number,
  dueDay: number,
): DueDateRule => ({
  dueDate,
  dueDay,
  dueMonth,
  recurrence: Recurrence.yearly,
});

describe('nextDueDate：每月', () => {
  it.each([
    ['一般日期', '2026-10-01', 1, '2026-11-01'],
    ['31 號遇到 2 月：當月最後一天（AC-14）', '2026-01-31', 31, '2026-02-28'],
    ['31 號遇到閏年 2 月：2/29（AC-14）', '2028-01-31', 31, '2028-02-29'],
    ['短月之後回到 31 號（AC-14）', '2026-02-28', 31, '2026-03-31'],
    ['31 號遇到 30 天的月份', '2026-10-31', 31, '2026-11-30'],
    ['30 號經過 2 月後回到 30 號', '2026-02-28', 30, '2026-03-30'],
    ['跨年', '2026-12-15', 15, '2027-01-15'],
  ])('%s：%s（dueDay %i）→ %s', (_name, dueDate, dueDay, expected) => {
    expect(nextDueDate(monthly(dueDate, dueDay))).toBe(expected);
  });

  it('31 號帳單連續推一年：短月是月底，其他月份回到 31 號', () => {
    const dates: string[] = [];
    let dueDate = '2026-01-31';
    for (let i = 0; i < 12; i += 1) {
      dueDate = nextDueDate(monthly(dueDate, 31));
      dates.push(dueDate);
    }
    expect(dates).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
    ]);
  });

  it('從到期日推算，不看繳費日：9/1 的房租 11/10 才繳，下一期還是 10/1（US-B19）', () => {
    expect(nextDueDate(monthly('2026-09-01', 1))).toBe('2026-10-01');
    expect(nextDueDate(monthly('2026-10-25', 25))).toBe('2026-11-25');
  });
});

describe('nextDueDate：每年', () => {
  it.each([
    ['一般日期', '2026-11-05', 11, 5, '2027-11-05'],
    ['2/29 遇到非閏年：2/28（AC-14）', '2028-02-29', 2, 29, '2029-02-28'],
    ['非閏年之間維持 2/28', '2029-02-28', 2, 29, '2030-02-28'],
    ['閏年回到 2/29（AC-14）', '2031-02-28', 2, 29, '2032-02-29'],
    ['31 號的月份每年都有 31 號', '2026-12-31', 12, 31, '2027-12-31'],
  ])(
    '%s：%s（每年 %i 月 %i 日）→ %s',
    (_name, dueDate, dueMonth, dueDay, expected) => {
      expect(nextDueDate(yearly(dueDate, dueMonth, dueDay))).toBe(expected);
    },
  );
});

describe('nextDueDate：不該發生的輸入', () => {
  it('不重複的帳單沒有下一期，丟錯', () => {
    expect(() =>
      nextDueDate({
        dueDate: '2026-11-01',
        dueDay: 1,
        dueMonth: null,
        recurrence: Recurrence.none,
      }),
    ).toThrow('不重複的帳單沒有下一期');
  });

  it('年度帳單沒有 dueMonth，丟錯', () => {
    expect(() =>
      nextDueDate({ ...yearly('2026-11-05', 11, 5), dueMonth: null }),
    ).toThrow('年度帳單一定要有 dueMonth');
  });

  it.each([
    ['dueDay 是 0', monthly('2026-11-01', 0)],
    ['dueDay 是 32', monthly('2026-11-01', 32)],
    ['dueMonth 是 13', yearly('2026-11-05', 13, 5)],
    ['到期日格式不對', monthly('2026-02-30', 1)],
  ])('%s：丟錯', (_name, rule) => {
    expect(() => nextDueDate(rule)).toThrow();
  });
});
