import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AccountDeleteQueryDto,
  AccountListQueryDto,
} from './account-query.dto.js';
import { CreateAccountDto } from './create-account.dto.js';
import { UpdateAccountDto } from './update-account.dto.js';

// 直接用 plainToInstance 加 validate() 驗 DTO（transform 也會套用）；請求中由全域 ValidationPipe 做同樣的事
async function invalidFields(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

const valid = {
  name: '台新銀行',
  accountType: 'bank',
  openingBalance: '100000.00',
  deductFromEstimate: true,
  note: '薪轉戶',
};

describe('CreateAccountDto', () => {
  it('合法範例通過；不帶 deductFromEstimate、note 也通過', async () => {
    expect(await invalidFields(CreateAccountDto, valid)).toEqual([]);
    const { deductFromEstimate: _d, note: _n, ...required } = valid;
    expect(await invalidFields(CreateAccountDto, required)).toEqual([]);
  });

  it('openingBalance 可以是負數（信用卡欠款；非信用卡在 service 擋）', async () => {
    expect(
      await invalidFields(CreateAccountDto, {
        ...valid,
        accountType: 'credit_card',
        openingBalance: '-30000',
      }),
    ).toEqual([]);
  });

  it.each([
    ['name', '   '],
    ['name', '帳'.repeat(31)],
    ['accountType', 'loan'],
    ['accountType', null],
    ['openingBalance', 100000],
    ['openingBalance', '1e5'],
    ['openingBalance', '0x10'],
    ['openingBalance', '1.234'],
    ['openingBalance', null],
    ['deductFromEstimate', 'true'],
    ['deductFromEstimate', null],
    ['note', '備'.repeat(201)],
  ])('%s = %j 失敗', async (field, value) => {
    expect(
      await invalidFields(CreateAccountDto, { ...valid, [field]: value }),
    ).toEqual([field]);
  });

  it('名稱前後的空白會被去掉；備註空白字串轉成 null', () => {
    const dto = plainToInstance(CreateAccountDto, {
      ...valid,
      name: '  台新銀行 ',
      note: '   ',
    });
    expect(dto.name).toBe('台新銀行');
    expect(dto.note).toBeNull();
  });
});

describe('UpdateAccountDto', () => {
  it('{} 通過（沒傳的欄位保持原值）', async () => {
    expect(await invalidFields(UpdateAccountDto, {})).toEqual([]);
  });

  it('note 傳 null 代表清空；isActive 可以是 true／false', async () => {
    expect(await invalidFields(UpdateAccountDto, { note: null })).toEqual([]);
    expect(await invalidFields(UpdateAccountDto, { isActive: false })).toEqual(
      [],
    );
  });

  it.each(['name', 'openingBalance', 'isActive'])(
    '不可為空的欄位 %s 傳 null 失敗',
    async (field) => {
      expect(await invalidFields(UpdateAccountDto, { [field]: null })).toEqual([
        field,
      ]);
    },
  );

  it('isActive 不接受字串', async () => {
    expect(
      await invalidFields(UpdateAccountDto, { isActive: 'false' }),
    ).toEqual(['isActive']);
  });
});

describe('AccountListQueryDto／AccountDeleteQueryDto', () => {
  it('不帶參數通過', async () => {
    expect(await invalidFields(AccountListQueryDto, {})).toEqual([]);
    expect(await invalidFields(AccountDeleteQueryDto, {})).toEqual([]);
  });

  it("'true'／'false' 轉成布林", () => {
    expect(
      plainToInstance(AccountListQueryDto, { includeInactive: 'true' })
        .includeInactive,
    ).toBe(true);
    expect(
      plainToInstance(AccountDeleteQueryDto, { addBackToEstimate: 'false' })
        .addBackToEstimate,
    ).toBe(false);
  });

  it.each(['', '1', 'yes', 'TRUE'])('includeInactive = %j 失敗', async (v) => {
    expect(
      await invalidFields(AccountListQueryDto, { includeInactive: v }),
    ).toEqual(['includeInactive']);
  });
});
