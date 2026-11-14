import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { toDbDate } from '../src/common/date-only.js';
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

    it('支出選了收入分類：400 CATEGORY_TYPE_MISMATCH', async () => {
      const res = await post({
        transactionType: 'expense',
        amount: '100',
        accountId: bankId,
        categoryId: salaryId,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'CATEGORY_TYPE_MISMATCH',
        details: [{ field: 'categoryId' }],
      });
      expect(await balanceOf(bankId)).toBe('100000.00');
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
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        details: [{ field: 'accountId' }],
      });
    });

    it('轉帳到停用的帳戶：409 ACCOUNT_INACTIVE（field toAccountId），餘額不變', async () => {
      await prisma.account.update({
        where: { id: cardId },
        data: { isActive: false },
      });
      const res = await post({
        transactionType: 'transfer',
        amount: '100',
        accountId: bankId,
        toAccountId: cardId,
      }).expect(409);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        details: [{ field: 'toAccountId' }],
      });
      expect(await balanceOf(bankId)).toBe('100000.00');
    });

    it('停用的分類：400 CATEGORY_NOT_FOUND', async () => {
      const oldFood = await createCategory(
        prisma,
        'old-food',
        CategoryType.expense,
        { isActive: false },
      );
      const res = await post({
        transactionType: 'expense',
        amount: '100',
        accountId: bankId,
        categoryId: oldFood,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'CATEGORY_NOT_FOUND',
        details: [{ field: 'categoryId' }],
      });
    });

    it.each([
      ['0', 'AMOUNT_NOT_POSITIVE'],
      ['-1', 'AMOUNT_NOT_POSITIVE'],
      ['abc', 'AMOUNT_INVALID'],
      ['', 'AMOUNT_INVALID'],
      [undefined, 'AMOUNT_INVALID'],
    ])('金額 %j：400 %s（AC-05）', async (amount, code) => {
      const res = await post({
        transactionType: 'expense',
        amount,
        accountId: bankId,
        categoryId: foodId,
      }).expect(400);
      expect(res.body).toMatchObject({ code, details: [{ field: 'amount' }] });
    });

    it.each(['', null, '2026-02-30'])(
      '日期 %j：400 VALIDATION_FAILED（AC-06）',
      async (transactionDate) => {
        const res = await post({
          transactionType: 'expense',
          amount: '100',
          accountId: bankId,
          categoryId: foodId,
          transactionDate,
        }).expect(400);
        expect(res.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          details: [{ field: 'transactionDate' }],
        });
      },
    );

    it('備註送空字串：存成 null', async () => {
      const res = await post({
        transactionType: 'expense',
        amount: '100',
        accountId: bankId,
        categoryId: foodId,
        note: '',
      }).expect(201);
      expect(res.body).toMatchObject({ note: null });
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

    it('同一天有多筆：依 createdAt 由新到舊，createdAt 相同再依 id 由大到小', async () => {
      const day = '2026-10-15';
      const add = async (createdAt: string, note: string) =>
        (
          await prisma.transaction.create({
            data: {
              userId,
              accountId: bankId,
              transactionType: TransactionType.expense,
              amount: '10',
              categoryId: foodId,
              transactionDate: toDbDate(day),
              createdAt: new Date(createdAt),
              note,
            },
            select: { id: true },
          })
        ).id;
      await add('2026-10-15T02:00:00Z', '最早');
      await add('2026-10-15T04:00:00Z', '最晚');
      const sameA = await add('2026-10-15T03:00:00Z', '同時 A');
      const sameB = await add('2026-10-15T03:00:00Z', '同時 B');
      // createdAt 相同的兩筆：id 大的在前（uuid 依字串比較，和 PostgreSQL 的排序一致）
      const [first, second] =
        sameA > sameB ? ['同時 A', '同時 B'] : ['同時 B', '同時 A'];

      const body = listBody(
        (await list(`?dateFrom=${day}&dateTo=${day}`)).body,
      );
      expect(body.items.map((t) => t.note)).toEqual([
        '最晚',
        first,
        second,
        '最早',
      ]);
    });

    it('未來日期的交易也會列出（排在最前面）', async () => {
      await createTransaction(prisma, {
        userId,
        accountId: bankId,
        transactionType: TransactionType.income,
        amount: '45000',
        categoryId: salaryId,
        transactionDate: '2026-11-05', // 晚於今天 2026-10-28
      });
      const body = listBody((await list()).body);
      expect(body.total).toBe(6);
      expect(body.items[0]).toMatchObject({
        transactionDate: '2026-11-05',
        amount: '45000.00',
      });
    });

    it.each([
      ['dateFrom=abc', 'dateFrom', 'VALIDATION_FAILED'],
      ['transactionType=xxx', 'transactionType', 'VALIDATION_FAILED'],
      ['categoryId=not-a-uuid', 'categoryId', 'CATEGORY_NOT_FOUND'],
    ])('query 格式錯誤 %s：400（field %s）', async (query, field, code) => {
      const res = await api()
        .get(`/api/v1/transactions?${query}`)
        .set('Authorization', auth)
        .expect(400);
      expect(res.body).toMatchObject({ code, details: [{ field }] });
    });

    it('篩選別人的分類：400 CATEGORY_NOT_FOUND', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      const otherFood = await createCategory(
        prisma,
        'other-food',
        CategoryType.expense,
        { userId: otherId },
      );
      const res = await api()
        .get(`/api/v1/transactions?categoryId=${otherFood}`)
        .set('Authorization', auth)
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'CATEGORY_NOT_FOUND',
        details: [{ field: 'categoryId' }],
      });
    });

    it('每筆都有 isBillGenerated', async () => {
      const { items } = (await list()).body as {
        items: { isBillGenerated: unknown }[];
      };
      expect(items).toHaveLength(5);
      expect(items.every((t) => t.isBillGenerated === false)).toBe(true);
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

  describe('PATCH /transactions/:id', () => {
    let lunchId: string;
    const patch = (id: string, body: Record<string, unknown>) =>
      api()
        .patch(`/api/v1/transactions/${id}`)
        .set('Authorization', auth)
        .send(body);
    const expense = (body: Record<string, unknown> = {}) =>
      post({
        transactionType: 'expense',
        amount: '120',
        accountId: bankId,
        categoryId: foodId,
        transactionDate: '2026-10-20',
        note: '午餐',
        ...body,
      }).expect(201);

    beforeEach(async () => {
      lunchId = ((await expense()).body as { id: string }).id;
    });

    it('改金額、日期、備註：沒傳的欄位保持原值，餘額跟著變', async () => {
      const res = await patch(lunchId, {
        amount: '150.5',
        transactionDate: '2026-10-21',
        note: '晚餐',
      }).expect(200);
      expect(res.body).toMatchObject({
        id: lunchId,
        transactionType: 'expense',
        amount: '150.50',
        accountId: bankId,
        categoryId: foodId,
        toAccountId: null,
        transactionDate: '2026-10-21',
        note: '晚餐',
        isBillGenerated: false,
      });
      expect(await balanceOf(bankId)).toBe('99849.50');
    });

    it('只改一個欄位：其他欄位不變', async () => {
      const res = await patch(lunchId, { note: '便當' }).expect(200);
      expect(res.body).toMatchObject({
        amount: '120.00',
        transactionDate: '2026-10-20',
        categoryId: foodId,
        note: '便當',
      });
    });

    it('note 傳 null 或空字串：清空', async () => {
      const res = await patch(lunchId, { note: null }).expect(200);
      expect(res.body).toMatchObject({ note: null });
      const res2 = await patch(lunchId, { note: '' }).expect(200);
      expect(res2.body).toMatchObject({ note: null });
    });

    it('空的 body：不改任何東西，回原本的交易', async () => {
      const res = await patch(lunchId, {}).expect(200);
      expect(res.body).toMatchObject({ amount: '120.00', note: '午餐' });
    });

    it('換帳戶：交易移到另一個帳戶，兩邊餘額都跟著變', async () => {
      await patch(lunchId, { accountId: cardId }).expect(200);
      expect(await balanceOf(bankId)).toBe('100000.00');
      expect(await balanceOf(cardId)).toBe('-120.00');
    });

    it('改成未來日期：不算進目前餘額（PRD 15.11）', async () => {
      await patch(lunchId, { transactionDate: '2026-11-05' }).expect(200);
      expect(await balanceOf(bankId)).toBe('100000.00');
    });

    it('支出改收入：分類一起換成收入分類，餘額由減變加', async () => {
      const res = await patch(lunchId, {
        transactionType: 'income',
        categoryId: salaryId,
      }).expect(200);
      expect(res.body).toMatchObject({
        transactionType: 'income',
        categoryId: salaryId,
      });
      expect(await balanceOf(bankId)).toBe('100120.00');
    });

    it('支出改收入但沒換分類：400 CATEGORY_TYPE_MISMATCH', async () => {
      const res = await patch(lunchId, { transactionType: 'income' }).expect(
        400,
      );
      expect(res.body).toMatchObject({
        code: 'CATEGORY_TYPE_MISMATCH',
        details: [{ field: 'categoryId' }],
      });
    });

    it('支出改轉帳：帶 toAccountId、categoryId 設成 null', async () => {
      const res = await patch(lunchId, {
        transactionType: 'transfer',
        toAccountId: cardId,
        categoryId: null,
      }).expect(200);
      expect(res.body).toMatchObject({
        transactionType: 'transfer',
        toAccountId: cardId,
        categoryId: null,
      });
      expect(await balanceOf(bankId)).toBe('99880.00');
      expect(await balanceOf(cardId)).toBe('120.00');
    });

    it.each([
      [
        '改轉帳卻沒清空分類',
        { transactionType: 'transfer', toAccountId: 'card' },
        'categoryId',
      ],
      [
        '改轉帳卻沒帶轉入帳戶',
        { transactionType: 'transfer', categoryId: null },
        'toAccountId',
      ],
      ['支出帶了轉入帳戶', { toAccountId: 'card' }, 'toAccountId'],
      ['支出把分類清空', { categoryId: null }, 'categoryId'],
    ])('%s：400 TRANSACTION_FIELDS_MISMATCH', async (_name, body, field) => {
      const resolved = Object.fromEntries(
        Object.entries(body).map(([k, v]) => [k, v === 'card' ? cardId : v]),
      );
      const res = await patch(lunchId, resolved).expect(400);
      expect(res.body).toMatchObject({
        code: 'TRANSACTION_FIELDS_MISMATCH',
        details: [{ field }],
      });
    });

    it('轉帳改支出：清空轉入帳戶、帶支出分類', async () => {
      const transfer = await post({
        transactionType: 'transfer',
        amount: '500',
        accountId: bankId,
        toAccountId: cardId,
      }).expect(201);
      const res = await patch((transfer.body as { id: string }).id, {
        transactionType: 'expense',
        toAccountId: null,
        categoryId: foodId,
      }).expect(200);
      expect(res.body).toMatchObject({
        transactionType: 'expense',
        toAccountId: null,
        categoryId: foodId,
      });
      expect(await balanceOf(cardId)).toBe('0.00');
    });

    it('轉帳改成轉給同一個帳戶：400 TRANSFER_SAME_ACCOUNT', async () => {
      const transfer = await post({
        transactionType: 'transfer',
        amount: '500',
        accountId: bankId,
        toAccountId: cardId,
      }).expect(201);
      const res = await patch((transfer.body as { id: string }).id, {
        toAccountId: bankId,
      }).expect(400);
      expect(res.body).toMatchObject({ code: 'TRANSFER_SAME_ACCOUNT' });
    });

    it.each([
      ['transactionType', 'VALIDATION_FAILED'],
      ['amount', 'AMOUNT_INVALID'],
      ['accountId', 'ACCOUNT_NOT_FOUND'],
      ['transactionDate', 'VALIDATION_FAILED'],
    ])('%s 傳 null：400 %s（不能清空）', async (field, code) => {
      const res = await patch(lunchId, { [field]: null }).expect(400);
      expect(res.body).toMatchObject({ code, details: [{ field }] });
    });

    it('金額 0：400 AMOUNT_NOT_POSITIVE', async () => {
      const res = await patch(lunchId, { amount: '0' }).expect(400);
      expect(res.body).toMatchObject({ code: 'AMOUNT_NOT_POSITIVE' });
    });

    it('別人的交易、不存在的交易：404 TRANSACTION_NOT_FOUND', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      const res = await api()
        .patch(`/api/v1/transactions/${lunchId}`)
        .set('Authorization', await bearer(app, otherId))
        .send({ amount: '1' })
        .expect(404);
      expect(res.body).toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
      await patch(NOT_EXIST, { amount: '1' }).expect(404);
      // 別人改不到：金額沒變
      expect(await balanceOf(bankId)).toBe('99880.00');
    });

    it('移到別人的帳戶、用別人的分類：400 NOT_FOUND，不洩漏是否存在（PRD 第 517 行）', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      const otherBank = await prisma.account.create({
        data: {
          userId: otherId,
          name: 'B',
          accountType: 'bank',
          openingBalance: 0,
        },
      });
      const otherFood = await createCategory(
        prisma,
        'other-food',
        CategoryType.expense,
        { userId: otherId },
      );
      const res = await patch(lunchId, { accountId: otherBank.id }).expect(400);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_NOT_FOUND',
        details: [{ field: 'accountId' }],
      });
      const res2 = await patch(lunchId, { categoryId: otherFood }).expect(400);
      expect(res2.body).toMatchObject({
        code: 'CATEGORY_NOT_FOUND',
        details: [{ field: 'categoryId' }],
      });
    });

    it('原本的帳戶停用：409 ACCOUNT_INACTIVE，什麼都不能改（AC-26）', async () => {
      await prisma.account.update({
        where: { id: bankId },
        data: { isActive: false },
      });
      const res = await patch(lunchId, { note: '只改備註' }).expect(409);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        details: [{ field: 'accountId' }],
      });
      // 也不能把交易移出停用帳戶
      await patch(lunchId, { accountId: cardId }).expect(409);
    });

    it('轉帳的轉入帳戶停用：409 ACCOUNT_INACTIVE（field toAccountId）', async () => {
      const transfer = await post({
        transactionType: 'transfer',
        amount: '500',
        accountId: bankId,
        toAccountId: cardId,
      }).expect(201);
      await prisma.account.update({
        where: { id: cardId },
        data: { isActive: false },
      });
      const res = await patch((transfer.body as { id: string }).id, {
        amount: '600',
      }).expect(409);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        details: [{ field: 'toAccountId' }],
      });
    });

    it('移進停用的帳戶：409 ACCOUNT_INACTIVE（PRD 15.11）', async () => {
      await prisma.account.update({
        where: { id: cardId },
        data: { isActive: false },
      });
      const res = await patch(lunchId, { accountId: cardId }).expect(409);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        details: [{ field: 'accountId' }],
      });
    });

    it('分類之後停用了：沒改分類時仍可以改金額；換成停用的分類回 400', async () => {
      const oldFood = await createCategory(
        prisma,
        'old-food',
        CategoryType.expense,
      );
      const created = await expense({ categoryId: oldFood });
      const id = (created.body as { id: string }).id;
      await prisma.category.update({
        where: { id: oldFood },
        data: { isActive: false },
      });
      await patch(id, { amount: '80' }).expect(200);
      const res = await patch(lunchId, { categoryId: oldFood }).expect(400);
      expect(res.body).toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    });

    it('帳單產生的交易：409 BILL_LINKED_TRANSACTION，內容不變（PRD 16.5）', async () => {
      const billTxId = await createBillTransaction();
      const res = await patch(billTxId, { amount: '1' }).expect(409);
      expect(res.body).toMatchObject({
        code: 'BILL_LINKED_TRANSACTION',
        details: [],
      });
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { id: billTxId },
      });
      expect(row.amount.toFixed(2)).toBe('18000.00');
    });

    it('同一筆同時改兩次：兩個都成功，結果是其中一個（不會壞掉）', async () => {
      const [a, b] = await Promise.all([
        patch(lunchId, { amount: '200' }),
        patch(lunchId, { amount: '300' }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(['99800.00', '99700.00']).toContain(await balanceOf(bankId));
    });
  });

  describe('DELETE /transactions/:id', () => {
    const del = (id: string) =>
      api().delete(`/api/v1/transactions/${id}`).set('Authorization', auth);

    it('刪除後餘額恢復，再查回 404；刪第二次也是 404', async () => {
      const created = await post({
        transactionType: 'expense',
        amount: '120',
        accountId: bankId,
        categoryId: foodId,
      }).expect(201);
      const id = (created.body as { id: string }).id;
      expect(await balanceOf(bankId)).toBe('99880.00');

      const res = await del(id).expect(204);
      expect(res.body).toEqual({});
      expect(await balanceOf(bankId)).toBe('100000.00');
      await api()
        .get(`/api/v1/transactions/${id}`)
        .set('Authorization', auth)
        .expect(404);
      await del(id).expect(404);
    });

    it('刪除轉帳：兩邊餘額都恢復', async () => {
      const created = await post({
        transactionType: 'transfer',
        amount: '500',
        accountId: bankId,
        toAccountId: cardId,
      }).expect(201);
      await del((created.body as { id: string }).id).expect(204);
      expect(await balanceOf(bankId)).toBe('100000.00');
      expect(await balanceOf(cardId)).toBe('0.00');
    });

    it('別人的交易：404，而且沒有被刪掉', async () => {
      const created = await post({
        transactionType: 'expense',
        amount: '120',
        accountId: bankId,
        categoryId: foodId,
      }).expect(201);
      const id = (created.body as { id: string }).id;
      const otherId = await createUser(prisma, 'c-other@example.com');
      const res = await api()
        .delete(`/api/v1/transactions/${id}`)
        .set('Authorization', await bearer(app, otherId))
        .expect(404);
      expect(res.body).toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
      expect(await prisma.transaction.count({ where: { id } })).toBe(1);
    });

    it.each([
      ['轉出帳戶', 'bank'],
      ['轉入帳戶', 'card'],
    ])(
      '%s停用：409 ACCOUNT_INACTIVE，details 是 []（AC-26）',
      async (_name, which) => {
        const created = await post({
          transactionType: 'transfer',
          amount: '500',
          accountId: bankId,
          toAccountId: cardId,
        }).expect(201);
        await prisma.account.update({
          where: { id: which === 'bank' ? bankId : cardId },
          data: { isActive: false },
        });
        const res = await del((created.body as { id: string }).id).expect(409);
        expect(res.body).toMatchObject({
          code: 'ACCOUNT_INACTIVE',
          details: [],
        });
      },
    );

    it('帳單產生的交易：409 BILL_LINKED_TRANSACTION，沒有被刪掉（PRD 16.5）', async () => {
      const billTxId = await createBillTransaction();
      const res = await del(billTxId).expect(409);
      expect(res.body).toMatchObject({
        code: 'BILL_LINKED_TRANSACTION',
        details: [],
      });
      expect(await prisma.transaction.count({ where: { id: billTxId } })).toBe(
        1,
      );
    });
  });

  describe(':id 格式', () => {
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

  /** 已繳帳單與它產生的支出（直接寫資料庫，模擬 E 的繳費）；回傳交易 id */
  async function createBillTransaction(): Promise<string> {
    const bill = await prisma.bill.create({
      data: {
        userId,
        name: '房租',
        amount: 18000,
        categoryId: foodId,
        accountId: bankId,
        dueDate: toDbDate('2026-10-05'),
        dueDay: 5,
        status: 'paid',
        paidAmount: 18000,
        paidDate: toDbDate('2026-10-05'),
      },
    });
    return (
      await prisma.transaction.create({
        data: {
          userId,
          accountId: bankId,
          transactionType: TransactionType.expense,
          amount: 18000,
          categoryId: foodId,
          transactionDate: toDbDate('2026-10-05'),
          note: '房租',
          billId: bill.id,
        },
      })
    ).id;
  }
});
