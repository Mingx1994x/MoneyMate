import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto.js';
import { TransactionListQueryDto } from './transaction-list-query.dto.js';
import { UpdateTransactionDto } from './update-transaction.dto.js';

// 直接用 plainToInstance 加 validate() 驗 DTO（transform 也會套用）；請求中由全域 ValidationPipe 做同樣的事
async function invalidFields(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

const ACCOUNT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TO_ACCOUNT = '2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182';
const CATEGORY = '7b1d6e2a-3c4f-4a8e-9d10-5e6f7a8b9c0d';

const expense = {
  transactionType: 'expense',
  amount: '120.00',
  accountId: ACCOUNT,
  categoryId: CATEGORY,
  transactionDate: '2026-10-25',
  note: '午餐',
};

describe('CreateTransactionDto', () => {
  it('支出合法；快速記帳只帶類型、金額、帳戶、分類也通過', async () => {
    expect(await invalidFields(CreateTransactionDto, expense)).toEqual([]);
    const { transactionDate: _d, note: _n, ...quick } = expense;
    expect(await invalidFields(CreateTransactionDto, quick)).toEqual([]);
  });

  it('轉帳不帶分類通過（欄位規則在 service 檢查）', async () => {
    expect(
      await invalidFields(CreateTransactionDto, {
        transactionType: 'transfer',
        amount: '20000',
        accountId: ACCOUNT,
        toAccountId: TO_ACCOUNT,
      }),
    ).toEqual([]);
  });

  it('categoryId、toAccountId、note 可以是 null', async () => {
    expect(
      await invalidFields(CreateTransactionDto, {
        ...expense,
        toAccountId: null,
        note: null,
      }),
    ).toEqual([]);
  });

  it.each([
    ['transactionType', 'adjustment'],
    ['transactionType', null],
    ['amount', '0'],
    ['amount', '-1'],
    ['amount', 120],
    ['amount', '1e3'],
    ['amount', null],
    ['accountId', 'not-a-uuid'],
    ['accountId', null],
    ['categoryId', 'food'],
    ['toAccountId', 'not-a-uuid'],
    ['transactionDate', '2026-02-30'],
    ['transactionDate', null],
    ['note', '備'.repeat(201)],
  ])('%s = %j 失敗', async (field, value) => {
    expect(
      await invalidFields(CreateTransactionDto, { ...expense, [field]: value }),
    ).toEqual([field]);
  });
});

describe('UpdateTransactionDto', () => {
  it('{} 通過（沒傳的欄位保持原值）', async () => {
    expect(await invalidFields(UpdateTransactionDto, {})).toEqual([]);
  });

  it('改成轉帳：帶 toAccountId 並把 categoryId 設成 null', async () => {
    expect(
      await invalidFields(UpdateTransactionDto, {
        transactionType: 'transfer',
        toAccountId: TO_ACCOUNT,
        categoryId: null,
      }),
    ).toEqual([]);
  });

  it.each(['transactionType', 'amount', 'accountId', 'transactionDate'])(
    '不可為空的欄位 %s 傳 null 失敗',
    async (field) => {
      expect(
        await invalidFields(UpdateTransactionDto, { [field]: null }),
      ).toEqual([field]);
    },
  );
});

describe('TransactionListQueryDto', () => {
  it('不帶參數通過，分頁用預設值', async () => {
    expect(await invalidFields(TransactionListQueryDto, {})).toEqual([]);
    const q = plainToInstance(TransactionListQueryDto, {});
    expect([q.page, q.pageSize]).toEqual([1, 20]);
  });

  it('query 字串全部帶上通過，分頁轉成數字', async () => {
    const plain = {
      page: '2',
      pageSize: '50',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      transactionType: 'expense',
      categoryId: CATEGORY,
      accountId: ACCOUNT,
    };
    expect(await invalidFields(TransactionListQueryDto, plain)).toEqual([]);
    expect(plainToInstance(TransactionListQueryDto, plain).pageSize).toBe(50);
  });

  it.each([
    ['page', '0'],
    ['pageSize', '101'],
    ['pageSize', ''],
    ['dateFrom', '2026-13-01'],
    ['dateTo', '20261031'],
    ['transactionType', 'income,expense'],
    ['categoryId', 'food'],
    ['accountId', 'abc'],
  ])('%s = %j 失敗', async (field, value) => {
    expect(
      await invalidFields(TransactionListQueryDto, { [field]: value }),
    ).toEqual([field]);
  });
});
