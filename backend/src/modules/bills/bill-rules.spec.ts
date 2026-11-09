import { AppException } from '../../common/errors/app.exception.js';
import { Recurrence } from '../../prisma/index.js';
import {
  assertDueDateNotTooFar,
  dueDayOf,
  dueMonthOf,
  splitPage,
} from './bill-rules.js';

describe('assertDueDateNotTooFar', () => {
  const TODAY = '2026-10-28';

  it.each([
    ['剛好 50 年', '2076-10-28'],
    ['過去的日期（建立後就是逾期）', '2020-01-01'],
    ['今天', TODAY],
  ])('%s：可以', (_name, dueDate) => {
    expect(() => assertDueDateNotTooFar(dueDate, TODAY)).not.toThrow();
  });

  it('50 年又 1 天：VALIDATION_FAILED（dueDate）', () => {
    let error: unknown;
    try {
      assertDueDateNotTooFar('2076-10-29', TODAY);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('VALIDATION_FAILED');
    expect((error as AppException).opts.details).toEqual([
      expect.objectContaining({ field: 'dueDate' }),
    ]);
  });

  it('今天是 2/29：50 年後沒有 2/29，上限是 2/28', () => {
    expect(() =>
      assertDueDateNotTooFar('2078-02-28', '2028-02-29'),
    ).not.toThrow();
    expect(() => assertDueDateNotTooFar('2078-03-01', '2028-02-29')).toThrow(
      AppException,
    );
  });
});

describe('dueDayOf、dueMonthOf', () => {
  it('dueDay 是到期日的日', () => {
    expect(dueDayOf('2026-01-31')).toBe(31);
    expect(dueDayOf('2026-11-01')).toBe(1);
  });

  it('dueMonth 只有每年帳單有值', () => {
    expect(dueMonthOf('2028-02-29', Recurrence.yearly)).toBe(2);
    expect(dueMonthOf('2026-12-31', Recurrence.yearly)).toBe(12);
    expect(dueMonthOf('2026-11-01', Recurrence.monthly)).toBeNull();
    expect(dueMonthOf('2026-11-01', Recurrence.none)).toBeNull();
  });
});

describe('splitPage（待繳在前、已繳在後，分兩次查）', () => {
  it.each([
    [
      '第 1 頁，待繳不滿一頁：待繳全取，已繳補滿',
      1,
      20,
      5,
      { first: { skip: 0, take: 5 }, second: { skip: 0, take: 15 } },
    ],
    [
      '第 1 頁，待繳超過一頁：只取待繳',
      1,
      20,
      25,
      { first: { skip: 0, take: 20 }, second: { skip: 0, take: 0 } },
    ],
    [
      '跨過兩組的交界：待繳剩 5 筆，已繳從第 1 筆取 15 筆',
      2,
      20,
      25,
      { first: { skip: 20, take: 5 }, second: { skip: 0, take: 15 } },
    ],
    [
      '交界之後：只取已繳，從第 16 筆開始',
      3,
      20,
      25,
      { first: { skip: 25, take: 0 }, second: { skip: 15, take: 20 } },
    ],
    [
      '沒有待繳：全部從已繳取',
      2,
      10,
      0,
      { first: { skip: 0, take: 0 }, second: { skip: 10, take: 10 } },
    ],
    [
      '待繳剛好一頁：下一頁從已繳第 1 筆開始',
      2,
      20,
      20,
      { first: { skip: 20, take: 0 }, second: { skip: 0, take: 20 } },
    ],
  ])('%s', (_name, page, pageSize, firstTotal, expected) => {
    expect(splitPage(page, pageSize, firstTotal)).toEqual(expected);
  });

  it('連續翻頁接起來，剛好是「待繳全部＋已繳全部」，不重複也不漏', () => {
    const pending = Array.from({ length: 23 }, (_, i) => `p${i}`);
    const paid = Array.from({ length: 31 }, (_, i) => `d${i}`);
    const seen: string[] = [];
    for (let page = 1; page <= 6; page += 1) {
      const { first, second } = splitPage(page, 10, pending.length);
      seen.push(
        ...pending.slice(first.skip, first.skip + first.take),
        ...paid.slice(second.skip, second.skip + second.take),
      );
    }
    expect(seen).toEqual([...pending, ...paid]);
  });
});
