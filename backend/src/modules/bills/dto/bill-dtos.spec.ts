import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BillListQueryDto } from './bill-list-query.dto.js';
import { CreateBillDto } from './create-bill.dto.js';
import { PayBillDto } from './pay-bill.dto.js';
import { StopRecurrenceDto } from './stop-recurrence.dto.js';
import { UpdateBillDto } from './update-bill.dto.js';

// INF-4 之前沒有全域 ValidationPipe，用 plainToInstance 加 validate() 驗（transform 也會套用）
async function invalidFields(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

const valid = {
  name: '房租',
  amount: '15000.00',
  categoryId: '0b8d3c7e-2f4a-4e6b-9c1d-5a7f8e9b0c21',
  accountId: '9e2f6a14-3b7c-4d8e-a5f1-6c0b2d4e8a73',
  dueDate: '2026-11-01',
  recurrence: 'monthly',
  note: '每月 1 日',
};

describe('CreateBillDto', () => {
  it('合法範例通過；不帶 recurrence、note 也通過', async () => {
    expect(await invalidFields(CreateBillDto, valid)).toEqual([]);
    const { recurrence: _r, note: _n, ...required } = valid;
    expect(await invalidFields(CreateBillDto, required)).toEqual([]);
  });

  it('note 可為 null；dueDate 在過去也通過（建立後就是逾期）', async () => {
    expect(
      await invalidFields(CreateBillDto, {
        ...valid,
        note: null,
        dueDate: '2026-09-01',
      }),
    ).toEqual([]);
  });

  it.each([
    ['amount', '0'],
    ['amount', '-1'],
    ['amount', 15000],
    ['amount', '1.234'],
    ['categoryId', 'not-a-uuid'],
    ['accountId', null],
    ['dueDate', '2026-02-30'],
    ['recurrence', null],
    ['recurrence', 'weekly'],
    ['name', '   '],
    ['name', '房'.repeat(31)],
    ['note', '備'.repeat(201)],
  ])('%s = %j 失敗', async (field, value) => {
    expect(
      await invalidFields(CreateBillDto, { ...valid, [field]: value }),
    ).toEqual([field]);
  });

  it('名稱前後的空白會被去掉；備註空白字串轉成 null', () => {
    const dto = plainToInstance(CreateBillDto, {
      ...valid,
      name: '  房租 ',
      note: '   ',
    });
    expect(dto.name).toBe('房租');
    expect(dto.note).toBeNull();
  });
});

describe('UpdateBillDto', () => {
  it('{} 通過（沒傳的欄位保持原值）；note 傳 null 代表清空', async () => {
    expect(await invalidFields(UpdateBillDto, {})).toEqual([]);
    expect(await invalidFields(UpdateBillDto, { note: null })).toEqual([]);
  });

  it.each([
    'name',
    'amount',
    'categoryId',
    'accountId',
    'dueDate',
    'recurrence',
  ])('不可為空的欄位 %s 傳 null 失敗', async (field) => {
    expect(await invalidFields(UpdateBillDto, { [field]: null })).toEqual([
      field,
    ]);
  });
});

describe('BillListQueryDto', () => {
  it('不帶任何參數通過，分頁用預設值', async () => {
    expect(await invalidFields(BillListQueryDto, {})).toEqual([]);
    expect(plainToInstance(BillListQueryDto, {})).toMatchObject({
      page: 1,
      pageSize: 20,
    });
  });

  it('query 字串通過', async () => {
    expect(
      await invalidFields(BillListQueryDto, {
        status: 'overdue',
        dueFrom: '2026-11-01',
        dueTo: '2026-11-30',
        page: '2',
        pageSize: '50',
      }),
    ).toEqual([]);
  });

  it.each([
    ['status', 'unpaid'],
    ['status', ''],
    ['dueFrom', '2026-11'],
    ['dueTo', '2026-11-31'],
    ['pageSize', '101'],
  ])('%s = %j 失敗', async (field, value) => {
    expect(await invalidFields(BillListQueryDto, { [field]: value })).toEqual([
      field,
    ]);
  });
});

describe('PayBillDto', () => {
  it('空 body 通過；兩個欄位都帶也通過', async () => {
    expect(await invalidFields(PayBillDto, {})).toEqual([]);
    expect(
      await invalidFields(PayBillDto, {
        paidAmount: '1180.00',
        paidDate: '2026-10-27',
      }),
    ).toEqual([]);
  });

  it.each([
    ['paidAmount', null],
    ['paidAmount', '0'],
    ['paidDate', null],
    ['paidDate', '2026-10-32'],
  ])('%s = %j 失敗', async (field, value) => {
    expect(await invalidFields(PayBillDto, { [field]: value })).toEqual([
      field,
    ]);
  });
});

describe('StopRecurrenceDto', () => {
  it.each([true, false])('keepCurrent = %j 通過', async (keepCurrent) => {
    expect(await invalidFields(StopRecurrenceDto, { keepCurrent })).toEqual([]);
  });

  it.each([undefined, null, 'true', 1])(
    'keepCurrent = %j 失敗（必填，而且要是布林）',
    async (keepCurrent) => {
      expect(await invalidFields(StopRecurrenceDto, { keepCurrent })).toEqual([
        'keepCurrent',
      ]);
    },
  );
});
