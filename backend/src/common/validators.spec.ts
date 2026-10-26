import { validate } from 'class-validator';
import {
  IS_DATE_ONLY,
  IS_MONEY,
  IS_MONTH,
  IsDateOnly,
  IsMoney,
  IsMonth,
  MONEY_NON_NEGATIVE,
  MONEY_POSITIVE,
} from './validators.js';

class Dto {
  @IsMoney({ sign: 'positive' })
  amount: unknown = '1';

  @IsMoney({ sign: 'nonNegative' })
  outstandingBalance: unknown = '0';

  @IsMoney({ sign: 'any' })
  openingBalance: unknown = '0';

  @IsDateOnly()
  date: unknown = '2026-10-23';

  @IsMonth()
  month: unknown = '2026-10';

  @IsMoney({ sign: 'positive' }, { each: true })
  amounts: unknown = ['1'];

  @IsMoney({ sign: 'positive' }, { message: '自訂訊息' })
  withMessage: unknown = '1';
}

/** 回傳指定欄位的 constraint 名稱；沒有錯誤時回空陣列。 */
async function constraintsOf(
  field: keyof Dto,
  value: unknown,
): Promise<string[]> {
  const dto = new Dto();
  dto[field] = value;
  const errors = await validate(dto);
  const error = errors.find((e) => e.property === field);
  return Object.keys(error?.constraints ?? {});
}

describe('@IsMoney', () => {
  it.each([
    ['amount', '0.01'],
    ['amount', '1234.50'],
    ['outstandingBalance', '0'],
    ['outstandingBalance', '-0'],
    ['openingBalance', '-30000'],
    ['openingBalance', '0'],
  ] as const)('%s = %j 通過', async (field, value) => {
    expect(await constraintsOf(field, value)).toEqual([]);
  });

  it.each([
    ['amount', '0', MONEY_POSITIVE],
    ['amount', '-1', MONEY_POSITIVE],
    ['amount', '-0.00', MONEY_POSITIVE],
    ['outstandingBalance', '-0.01', MONEY_NON_NEGATIVE],
  ] as const)('%s = %j 只報 %s', async (field, value, constraint) => {
    expect(await constraintsOf(field, value)).toEqual([constraint]);
  });

  it.each([
    ['amount', '1.234'],
    ['amount', '-1.234'],
    ['amount', 1234.5],
    ['outstandingBalance', '1e3'],
    ['openingBalance', null],
  ] as const)('%s = %j 格式錯時只報 isMoney', async (field, value) => {
    expect(await constraintsOf(field, value)).toEqual([IS_MONEY]);
  });

  it('each: true 時逐一檢查陣列元素（正負檢查也要拿到 validationOptions）', async () => {
    expect(await constraintsOf('amounts', ['1', '2.5'])).toEqual([]);
    expect(await constraintsOf('amounts', ['1', '-1'])).toEqual([
      MONEY_POSITIVE,
    ]);
    expect(await constraintsOf('amounts', ['1', '1.234'])).toEqual([IS_MONEY]);
  });

  it('自訂 message 套用到格式與正負兩個 constraint', async () => {
    const dto = new Dto();
    dto.withMessage = '0';
    const errors = await validate(dto);
    expect(
      errors.find((e) => e.property === 'withMessage')?.constraints,
    ).toEqual({ [MONEY_POSITIVE]: '自訂訊息' });
    dto.withMessage = 'x';
    const errors2 = await validate(dto);
    expect(
      errors2.find((e) => e.property === 'withMessage')?.constraints,
    ).toEqual({ [IS_MONEY]: '自訂訊息' });
  });

  it('錯誤訊息不含輸入值', async () => {
    const dto = new Dto();
    dto.amount = 'secret';
    const [error] = await validate(dto);
    expect(Object.values(error.constraints ?? {}).join()).not.toContain(
      'secret',
    );
  });
});

describe('@IsMonth', () => {
  it('有效月份通過', async () => {
    expect(await constraintsOf('month', '2026-12')).toEqual([]);
  });

  it.each(['2026-13', '2026-00', '2026-1', '2026-10-01', 202610, null])(
    '%j 不通過',
    async (value) => {
      expect(await constraintsOf('month', value)).toEqual([IS_MONTH]);
    },
  );
});

describe('@IsDateOnly', () => {
  it('有效日期通過', async () => {
    expect(await constraintsOf('date', '2024-02-29')).toEqual([]);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-1-5', 20261023, null])(
    '%j 不通過',
    async (value) => {
      expect(await constraintsOf('date', value)).toEqual([IS_DATE_ONLY]);
    },
  );
});
