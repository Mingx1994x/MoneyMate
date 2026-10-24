import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLoanDto } from './create-loan.dto.js';
import { LoanPaymentPreviewQueryDto } from './loan-payment-preview.dto.js';
import { UpdateLoanDto } from './update-loan.dto.js';

// INF-4 之前沒有全域 ValidationPipe，用 plainToInstance 加 validate() 驗（transform 也會套用）
async function invalidFields(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

const valid = {
  name: '房貸',
  loanType: 'mortgage',
  outstandingBalance: '1000000.00',
  monthlyPayment: '17969.00',
  paymentDay: 5,
  endDate: '2031-09-30',
  interestRate: 3,
  status: 'active',
  note: '每月 5 日自動扣款',
};

describe('CreateLoanDto', () => {
  it('合法範例通過；不帶 monthlyPayment、interestRate、status、note 也通過', async () => {
    expect(await invalidFields(CreateLoanDto, valid)).toEqual([]);
    const {
      monthlyPayment: _m,
      interestRate: _i,
      status: _s,
      note: _n,
      ...required
    } = valid;
    expect(await invalidFields(CreateLoanDto, required)).toEqual([]);
  });

  it('interestRate、note 可為 null；餘額 0 通過（已還完）', async () => {
    expect(
      await invalidFields(CreateLoanDto, {
        ...valid,
        interestRate: null,
        note: null,
        outstandingBalance: '0',
      }),
    ).toEqual([]);
  });

  it.each([
    ['monthlyPayment', null],
    ['monthlyPayment', '0'],
    ['outstandingBalance', '-1'],
    ['outstandingBalance', 1000000],
    ['paymentDay', 0],
    ['paymentDay', 32],
    ['paymentDay', 5.5],
    ['interestRate', 100.0001],
    ['interestRate', 1e-7],
    ['interestRate', '3'],
    ['endDate', '2026-02-30'],
    ['name', '   '],
    ['name', '房'.repeat(31)],
    ['status', null],
    ['status', 'paid'],
    ['loanType', 'house'],
    ['note', '備'.repeat(201)],
  ])('%s = %j 失敗', async (field, value) => {
    expect(
      await invalidFields(CreateLoanDto, { ...valid, [field]: value }),
    ).toEqual([field]);
  });

  it('名稱前後的空白會被去掉；備註空白字串轉成 null', () => {
    const dto = plainToInstance(CreateLoanDto, {
      ...valid,
      name: '  房貸 ',
      note: '   ',
    });
    expect(dto.name).toBe('房貸');
    expect(dto.note).toBeNull();
  });
});

describe('UpdateLoanDto', () => {
  it('{} 通過（沒傳的欄位保持原值）', async () => {
    expect(await invalidFields(UpdateLoanDto, {})).toEqual([]);
  });

  it('可為空的欄位傳 null 代表清空', async () => {
    expect(
      await invalidFields(UpdateLoanDto, { note: null, interestRate: null }),
    ).toEqual([]);
  });

  it.each([
    'name',
    'monthlyPayment',
    'outstandingBalance',
    'status',
    'endDate',
  ])('不可為空的欄位 %s 傳 null 失敗', async (field) => {
    expect(await invalidFields(UpdateLoanDto, { [field]: null })).toEqual([
      field,
    ]);
  });

  it('有傳的欄位照樣驗證', async () => {
    expect(await invalidFields(UpdateLoanDto, { paymentDay: 32 })).toEqual([
      'paymentDay',
    ]);
  });
});

describe('LoanPaymentPreviewQueryDto', () => {
  const query = {
    outstandingBalance: '1000000',
    interestRate: '3',
    endDate: '2031-09-30',
  };

  it('query 字串通過，利率轉成數字', async () => {
    expect(await invalidFields(LoanPaymentPreviewQueryDto, query)).toEqual([]);
    expect(
      plainToInstance(LoanPaymentPreviewQueryDto, query).interestRate,
    ).toBe(3);
  });

  it.each([
    ['interestRate', ''],
    ['interestRate', '0x10'],
    ['interestRate', '1e1'],
    ['outstandingBalance', '0'],
    ['endDate', '2031-02-30'],
  ])('%s = %j 失敗（空字串不會被當成 0%）', async (field, value) => {
    expect(
      await invalidFields(LoanPaymentPreviewQueryDto, {
        ...query,
        [field]: value,
      }),
    ).toEqual([field]);
  });

  it('利率 0% 可以試算', async () => {
    expect(
      await invalidFields(LoanPaymentPreviewQueryDto, {
        ...query,
        interestRate: '0',
      }),
    ).toEqual([]);
  });
});
