import { plainToInstance } from 'class-transformer';
import { IsOptional, validate } from 'class-validator';
import {
  EmptyToNull,
  IS_BOOLEAN_QUERY,
  IS_DATE_ONLY,
  IS_MONEY,
  IS_MONTH,
  IS_NAME,
  IS_NOTE,
  IS_RATE,
  IsBooleanQuery,
  IsDateOnly,
  IsMoney,
  IsMonth,
  IsName,
  IsNote,
  IsRate,
  MONEY_NON_NEGATIVE,
  MONEY_POSITIVE,
  ToNumber,
  Trim,
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

class TextDto {
  @IsName()
  name: unknown = '房貸';

  @IsOptional()
  @IsNote()
  note: unknown = null;

  @IsRate()
  rate: unknown = 3;
}

async function textConstraintsOf(
  field: keyof TextDto,
  value: unknown,
): Promise<string[]> {
  const dto = new TextDto();
  dto[field] = value;
  const errors = await validate(dto);
  const error = errors.find((e) => e.property === field);
  return Object.keys(error?.constraints ?? {});
}

describe('@IsName', () => {
  it.each([
    ['一個字', '房'],
    ['30 個中文字', '房'.repeat(30)],
    ['30 個 emoji（以 code point 計算）', '😀'.repeat(30)],
    ['前後空白不算進長度', `  ${'房'.repeat(30)}  `],
  ])('%s 通過', async (_label, value) => {
    expect(await textConstraintsOf('name', value)).toEqual([]);
  });

  it.each([
    ['31 個中文字', '房'.repeat(31)],
    ['只有空白', '   '],
    ['空字串', ''],
    ['非字串', 123],
    ['null', null],
  ])('%s 失敗', async (_label, value) => {
    expect(await textConstraintsOf('name', value)).toEqual([IS_NAME]);
  });
});

describe('@IsNote', () => {
  it('200 字通過、201 字失敗；可為 null 的欄位搭配 @IsOptional()', async () => {
    expect(await textConstraintsOf('note', '備'.repeat(200))).toEqual([]);
    expect(await textConstraintsOf('note', '備'.repeat(201))).toEqual([
      IS_NOTE,
    ]);
    expect(await textConstraintsOf('note', null)).toEqual([]);
    expect(await textConstraintsOf('note', 1)).toEqual([IS_NOTE]);
  });
});

describe('@IsRate', () => {
  it.each([0, 3, 3.125, 100])('%s 通過', async (value) => {
    expect(await textConstraintsOf('rate', value)).toEqual([]);
  });

  it.each([100.001, -1, 3.1255, 1e-7, 5e-324, Number.NaN, Infinity, '3'])(
    '%s 失敗，而且不丟例外',
    async (value) => {
      expect(await textConstraintsOf('rate', value)).toEqual([IS_RATE]);
    },
  );
});

class QueryDto {
  @ToNumber()
  @IsRate()
  rate!: unknown;

  @IsBooleanQuery()
  includeInactive!: unknown;
}

async function queryConstraintsOf(
  plain: Record<string, unknown>,
  field: keyof QueryDto,
): Promise<{ value: unknown; constraints: string[] }> {
  const dto = plainToInstance(QueryDto, {
    rate: '3',
    includeInactive: 'true',
    ...plain,
  });
  const errors = await validate(dto);
  const error = errors.find((e) => e.property === field);
  return {
    value: dto[field],
    constraints: Object.keys(error?.constraints ?? {}),
  };
}

describe('@ToNumber', () => {
  it('純數字字串轉成數字', async () => {
    expect(await queryConstraintsOf({ rate: '3.125' }, 'rate')).toEqual({
      value: 3.125,
      constraints: [],
    });
  });

  it.each(['', ' ', '0x10', '1e1', 'abc', '-1', '3.1255'])(
    '%j 保留原值，交給 @IsRate 擋下（不會變成 0%）',
    async (raw) => {
      expect(await queryConstraintsOf({ rate: raw }, 'rate')).toEqual({
        value: raw,
        constraints: [IS_RATE],
      });
    },
  );
});

describe('@IsBooleanQuery', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('%j 轉成 %s', async (raw, expected) => {
    expect(
      await queryConstraintsOf({ includeInactive: raw }, 'includeInactive'),
    ).toEqual({
      value: expected,
      constraints: [],
    });
  });

  it.each(['1', 'yes', '', 'TRUE'])('%j 失敗', async (raw) => {
    expect(
      (await queryConstraintsOf({ includeInactive: raw }, 'includeInactive'))
        .constraints,
    ).toEqual([IS_BOOLEAN_QUERY]);
  });
});

class TransformDto {
  @Trim()
  name!: unknown;

  @EmptyToNull()
  note!: unknown;
}

describe('@Trim、@EmptyToNull', () => {
  it('去除前後空白；空白字串轉成 null；非字串不動', () => {
    expect(
      plainToInstance(TransformDto, { name: '  a ', note: '   ' }),
    ).toEqual({
      name: 'a',
      note: null,
    });
    expect(plainToInstance(TransformDto, { name: 1, note: ' 備註 ' })).toEqual({
      name: 1,
      note: ' 備註 ',
    });
  });
});
