import { Prisma } from '../prisma/index.js';
import { isMoneyString, toMoney, toMoneyString } from './money.js';

describe('isMoneyString', () => {
  it.each(['0', '0.5', '1234.50', '-1.25', '-0.00', '999999999999.99'])(
    '%j 通過',
    (v) => {
      expect(isMoneyString(v)).toBe(true);
    },
  );

  it.each([
    ['13 位整數', '1000000000000'],
    ['前導 0', '007'],
    ['小數點後沒有數字', '1.'],
    ['沒有整數部分', '.5'],
    ['3 位小數', '1.234'],
    ['科學記號', '1e3'],
    ['16 進位', '0x10'],
    ['Infinity', 'Infinity'],
    ['正號', '+1'],
    ['空字串', ''],
    ['只有負號', '-'],
    ['前面有空白', ' 1'],
    ['結尾換行', '1\n'],
    ['千分位', '1,000'],
    ['全形數字', '１２'],
  ])('%s（%j）不通過', (_, v) => {
    expect(isMoneyString(v)).toBe(false);
  });

  it.each([
    ['數字', 1234.5],
    ['陣列', ['1']],
    ['物件', {}],
    ['null', null],
    ['undefined', undefined],
  ])('非字串（%s）不通過', (_, v) => {
    expect(isMoneyString(v)).toBe(false);
  });

  it('同一個字串連續呼叫結果相同（regex 沒有 g flag 的狀態）', () => {
    expect(isMoneyString('12.34')).toBe(true);
    expect(isMoneyString('12.34')).toBe(true);
  });
});

describe('toMoney', () => {
  it('合法字串轉成 Decimal', () => {
    expect(toMoney('1234.5').equals(new Prisma.Decimal('1234.5'))).toBe(true);
  });

  it('格式不對就丟錯，訊息不含輸入值', () => {
    expect(() => toMoney('0x10')).toThrow(Error);
    let message = '';
    try {
      toMoney('secret-0x10');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('secret');
  });

  it("'-0' 不算負數（正負要用 lt／gte 比較，不用 isNeg）", () => {
    expect(toMoney('-0').lt(0)).toBe(false);
    expect(toMoney('-0').gte(0)).toBe(true);
  });
});

describe('toMoneyString', () => {
  it.each([
    ['1234.00', '1234.00'],
    ['1.5', '1.50'],
    ['-30000', '-30000.00'],
    ['-0', '0.00'],
  ])('%s → %s', (input, expected) => {
    expect(toMoneyString(new Prisma.Decimal(input))).toBe(expected);
  });

  it('超過 2 位小數就丟錯，不自行進位', () => {
    expect(() => toMoneyString(new Prisma.Decimal('1.005'))).toThrow(Error);
    expect(() => toMoneyString(new Prisma.Decimal(100000).div(3))).toThrow(
      Error,
    );
  });

  it('明確進位後可以輸出', () => {
    const d = new Prisma.Decimal(100000)
      .div(3)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    expect(toMoneyString(d)).toBe('33333.33');
  });

  it('不是有限值就丟錯', () => {
    expect(() => toMoneyString(new Prisma.Decimal('Infinity'))).toThrow(Error);
    expect(() => toMoneyString(new Prisma.Decimal('NaN'))).toThrow(Error);
  });
});
