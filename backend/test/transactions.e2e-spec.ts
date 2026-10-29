import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import {
  CategoryType,
  PrismaService,
  TransactionType,
} from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  createCategory,
  createTransaction,
  createUser,
  resetDb,
} from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

const TODAY = '2026-10-28';
const NOT_EXIST = '5c4b3a29-1807-4f6e-8d5c-4b3a29180765';

describe('交易 API（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let auth: string;
  let bankId: string;
  let cardId: string;
  let salaryId: string;
  let foodId: string;

  const api = () => request(app.getHttpServer());
  const post = (body: Record<string, unknown>) =>
    api().post('/api/v1/transactions').set('Authorization', auth).send(body);
  const balanceOf = async (id: string): Promise<string> => {
    const res = await api()
      .get(`/api/v1/accounts/${id}`)
      .set('Authorization', auth)
      .expect(200);
    return (res.body as { currentBalance: string }).currentBalance;
  };
  /** 列表回應收窄型別（res.body 是 any） */
  const listBody = (body: unknown) =>
    body as {
      page: number;
      pageSize: number;
      total: number;
      items: { amount: string; transactionDate: string; note: string | null }[];
    };

  beforeAll(async () => {
    const clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'c-transactions@example.com');
    auth = await bearer(app, userId);
    bankId = (
      await prisma.account.create({
        data: {
          userId,
          name: '銀行',
          accountType: 'bank',
          openingBalance: 100000,
        },
      })
    ).id;
    cardId = (
      await prisma.account.create({
        data: {
          userId,
          name: '信用卡',
          accountType: 'credit_card',
          openingBalance: 0,
        },
      })
    ).id;
    salaryId = await createCategory(prisma, 'salary', CategoryType.income);
    foodId = await createCategory(prisma, 'food', CategoryType.expense);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  describe('POST /transactions', () => {
    it('快速記帳：只帶類型、金額、帳戶、分類，日期是台北今天，餘額跟著變', async () => {
      const res = await post({
        transactionType: 'expense',
        amount: '120',
        accountId: bankId,
        categoryId: foodId,
      }).expect(201);
      expect(res.body).toMatchObject({
        transactionType: 'expense',
        amount: '120.00',
        accountId: bankId,
        categoryId: foodId,
        toAccountId: null,
        transactionDate: TODAY,
        note: null,
        billId: null,
        isBillGenerated: false,
      });
      expect(res.body).not.toHaveProperty('userId');
      expect(await balanceOf(bankId)).toBe('99880.00');
    });

    it('收入：餘額增加', async () => {
      await post({
        transactionType: 'income',
        amount: '50000',
        accountId: bankId,
        categoryId: salaryId,
      }).expect(201);
      expect(await balanceOf(bankId)).toBe('150000.00');
    });

    it('繳卡費＝銀行 → 信用卡的轉帳：銀行減少、信用卡欠款減少（AC-08）', async () => {
      await post({
        transactionType: 'expense',
        amount: '30000',
        accountId: cardId,
        categoryId: foodId,
      }).expect(201);
      await post({
        transactionType: 'transfer',
        amount: '20000',
        accountId: bankId,
        toAccountId: cardId,
      }).expect(201);
      expect(await balanceOf(bankId)).toBe('80000.00');
      expect(await balanceOf(cardId)).toBe('-10000.00');
    });

    it('預記下個月的薪水：不增加目前餘額（AC-19）', async () => {
      await post({
        transactionType: 'income',
        amount: '50000',
        accountId: bankId,
        categoryId: salaryId,
        transactionDate: '2026-11-05',
      }).expect(201);
      expect(await balanceOf(bankId)).toBe('100000.00');
    });

    it.each([
      [
        '轉帳帶了分類',
        {
          transactionType: 'transfer',
          toAccountId: 'CARD',
          categoryId: 'FOOD',
        },
        'categoryId',
      ],
      ['轉帳沒帶轉入帳戶', { transactionType: 'transfer' }, 'toAccountId'],
      [
        '支出帶了轉入帳戶',
        { transactionType: 'expense', categoryId: 'FOOD', toAccountId: 'CARD' },
        'toAccountId',
      ],
      ['支出沒帶分類', { transactionType: 'expense' }, 'categoryId'],
    ])('%s：400 TRANSACTION_FIELDS_MISMATCH', async (_name, body, field) => {
      const ids: Record<string, string> = { CARD: cardId, FOOD: foodId };
      const resolved = Object.fromEntries(
        Object.entries(body).map(([k, v]) => [k, ids[v] ?? v]),
      );
      const res = await post({
        amount: '100',
        accountId: bankId,
        ...resolved,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'TRANSACTION_FIELDS_MISMATCH',
        details: [{ field }],
      });
    });

    it('轉帳給同一個帳戶：400 TRANSFER_SAME_ACCOUNT', async () => {
      const res = await post({
        transactionType: 'transfer',
        amount: '100',
        accountId: bankId,
        toAccountId: bankId,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'TRANSFER_SAME_ACCOUNT',
        details: [{ field: 'toAccountId' }],
      });
    });

    it('收入選了支出分類：400 CATEGORY_TYPE_MISMATCH', async () => {
      const res = await post({
        transactionType: 'income',
        amount: '100',
        accountId: bankId,
        categoryId: foodId,
      }).expect(400);
      expect(res.body).toMatchObject({ code: 'CATEGORY_TYPE_MISMATCH' });
    });

    it('引用別人的帳戶、轉入帳戶、分類：400 NOT_FOUND，不洩漏是否存在（AC-24）', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      const otherAccount = await prisma.account.create({
        data: {
          userId: otherId,
          name: 'B',
          accountType: 'bank',
          openingBalance: 0,
        },
      });
      const otherCategory = await createCategory(
        prisma,
        'b_food',
        CategoryType.expense,
        {
          userId: otherId,
        },
      );

      const asAccount = await post({
        transactionType: 'expense',
        amount: '100',
        accountId: otherAccount.id,
        categoryId: foodId,
      }).expect(400);
      expect(asAccount.body).toMatchObject({
        code: 'ACCOUNT_NOT_FOUND',
        details: [{ field: 'accountId' }],
      });

      const asTarget = await post({
        transactionType: 'transfer',
        amount: '100',
        accountId: bankId,
        toAccountId: otherAccount.id,
      }).expect(400);
      expect(asTarget.body).toMatchObject({
        code: 'ACCOUNT_NOT_FOUND',
        details: [{ field: 'toAccountId' }],
      });

      const asCategory = await post({
        transactionType: 'expense',
        amount: '100',
        accountId: bankId,
        categoryId: otherCategory,
      }).expect(400);
      expect(asCategory.body).toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    });

    it('停用的帳戶：409 ACCOUNT_INACTIVE', async () => {
      await prisma.account.update({
        where: { id: bankId },
        data: { isActive: false },
      });
      const res = await post({
        transactionType: 'expense',
        amount: '100',
        accountId: bankId,
        categoryId: foodId,
      }).expect(409);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    });

    it.each(['0', '-1', 'abc'])('金額 %j：400（全域驗證）', async (amount) => {
      await post({
        transactionType: 'expense',
        amount,
        accountId: bankId,
        categoryId: foodId,
      }).expect(400);
    });
  });

  describe('GET /transactions', () => {
    beforeEach(async () => {
      const base = { userId, accountId: bankId };
      await createTransaction(prisma, {
        ...base,
        transactionType: TransactionType.expense,
        amount: '100',
        categoryId: foodId,
        transactionDate: '2026-10-01',
      });
      await createTransaction(prisma, {
        ...base,
        transactionType: TransactionType.income,
        amount: '50000',
        categoryId: salaryId,
        transactionDate: '2026-10-05',
      });
      await createTransaction(prisma, {
        ...base,
        transactionType: TransactionType.expense,
        amount: '200',
        categoryId: foodId,
        transactionDate: '2026-10-20',
      });
      await createTransaction(prisma, {
        ...base,
        transactionType: TransactionType.transfer,
        amount: '3000',
        toAccountId: cardId,
        transactionDate: '2026-10-25',
      });
      await createTransaction(prisma, {
        ...base,
        transactionType: TransactionType.expense,
        amount: '300',
        categoryId: foodId,
        transactionDate: '2026-09-30',
      });
    });

    const list = (query = '') =>
      api()
        .get(`/api/v1/transactions${query}`)
        .set('Authorization', auth)
        .expect(200);

    it('預設：日期由新到舊、第 1 頁、每頁 20 筆', async () => {
      const body = listBody((await list()).body);
      expect(body).toMatchObject({ page: 1, pageSize: 20, total: 5 });
      expect(body.items.map((t) => t.transactionDate)).toEqual([
        '2026-10-25',
        '2026-10-20',
        '2026-10-05',
        '2026-10-01',
        '2026-09-30',
      ]);
    });

    it('日期範圍（含頭尾）', async () => {
      const body = listBody(
        (await list('?dateFrom=2026-10-01&dateTo=2026-10-20')).body,
      );
      expect(body.total).toBe(3);
    });

    it('類型＋分類', async () => {
      const body = listBody(
        (await list(`?transactionType=expense&categoryId=${foodId}`)).body,
      );
      expect(body.items.map((t) => t.amount)).toEqual([
        '200.00',
        '100.00',
        '300.00',
      ]);
    });

    it('帳戶：轉入這個帳戶的轉帳也列出', async () => {
      const body = listBody((await list(`?accountId=${cardId}`)).body);
      expect(body.items.map((t) => t.amount)).toEqual(['3000.00']);
    });

    it('分頁', async () => {
      const body = listBody((await list('?page=2&pageSize=2')).body);
      expect(body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
      expect(body.items.map((t) => t.transactionDate)).toEqual([
        '2026-10-05',
        '2026-10-01',
      ]);
    });

    it('看不到別人的交易', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      auth = await bearer(app, otherId);
      const body = listBody((await list()).body);
      expect(body.total).toBe(0);
    });

    it('dateTo 早於 dateFrom：400 VALIDATION_FAILED', async () => {
      const res = await api()
        .get('/api/v1/transactions?dateFrom=2026-10-20&dateTo=2026-10-01')
        .set('Authorization', auth)
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'dateTo' }],
      });
    });

    it('篩選別人的帳戶：400 ACCOUNT_NOT_FOUND', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      const other = await prisma.account.create({
        data: {
          userId: otherId,
          name: 'B',
          accountType: 'bank',
          openingBalance: 0,
        },
      });
      const res = await api()
        .get(`/api/v1/transactions?accountId=${other.id}`)
        .set('Authorization', auth)
        .expect(400);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    });
  });

  describe('GET /transactions/:id', () => {
    it('取得自己的交易；別人的回 404', async () => {
      const created = await post({
        transactionType: 'expense',
        amount: '120',
        accountId: bankId,
        categoryId: foodId,
        note: '午餐',
      }).expect(201);
      const id = (created.body as { id: string }).id;

      const mine = await api()
        .get(`/api/v1/transactions/${id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(mine.body).toMatchObject({ id, note: '午餐' });

      const otherId = await createUser(prisma, 'c-other@example.com');
      const res = await api()
        .get(`/api/v1/transactions/${id}`)
        .set('Authorization', await bearer(app, otherId))
        .expect(404);
      expect(res.body).toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
    });
  });

  describe('還沒實作的端點（W3）', () => {
    it.each([
      ['patch', { amount: '150.00' }],
      ['delete', undefined],
    ] as const)('%s 回 501 NOT_IMPLEMENTED', async (method, body) => {
      await api()
        [method](`/api/v1/transactions/${NOT_EXIST}`)
        .set('Authorization', auth)
        .send(body)
        .expect(501);
    });

    it.each(['get', 'patch', 'delete'] as const)(
      '%s 的 :id 不是 UUID 時回 404 TRANSACTION_NOT_FOUND',
      async (method) => {
        const res = await api()
          [method]('/api/v1/transactions/not-a-uuid')
          .set('Authorization', auth)
          .expect(404);
        expect(res.body).toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
      },
    );
  });
});
