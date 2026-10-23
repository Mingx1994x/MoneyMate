import { validate } from 'class-validator';
import {
  IS_DATE_ONLY,
  IS_MONEY,
  IsDateOnly,
  IsMoney,
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

  it('錯誤訊息不含輸入值', async () => {
    const dto = new Dto();
    dto.amount = 'secret';
    const [error] = await validate(dto);
    expect(Object.values(error.constraints ?? {}).join()).not.toContain(
      'secret',
    );
  });
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
