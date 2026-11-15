import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CategoryType, PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { createCategory, createUser, resetDb } from './utils/db.js';
import { bearer } from './utils/test-token.js';

const { income, expense } = CategoryType;

describe('分類 API（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let auth: string;

  const list = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/categories${query}`)
      .set('Authorization', auth);
  /** 回應的 items 依序取出 code（res.body 是 any，先收窄型別） */
  const codes = (body: unknown) =>
    (body as { items: { code: string }[] }).items.map((c) => c.code);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'c-categories@example.com');
    auth = await bearer(app, userId);
    // 跟 D 的 seed 一樣：收入、支出各自從 1 開始，「其他」是 99；故意打亂建立順序
    await createCategory(prisma, 'other_expense', expense, { sortOrder: 99 });
    await createCategory(prisma, 'food', expense, { sortOrder: 1 });
    await createCategory(prisma, 'other_income', income, { sortOrder: 99 });
    await createCategory(prisma, 'salary', income, { sortOrder: 1 });
    await createCategory(prisma, 'transport', expense, { sortOrder: 2 });
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  it('全部：先收入再支出，同類型依 sortOrder，「其他」排在該類型最後', async () => {
    const res = await list().expect(200);
    expect(codes(res.body)).toEqual([
      'salary',
      'other_income',
      'food',
      'transport',
      'other_expense',
    ]);
  });

  it('回應欄位：id、code、name、type、sortOrder，不含 userId、isActive', async () => {
    const res = await list('?type=income').expect(200);
    const { items } = res.body as { items: Record<string, unknown>[] };
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      'code',
      'id',
      'name',
      'sortOrder',
      'type',
    ]);
  });

  it.each([
    ['income', ['salary', 'other_income']],
    ['expense', ['food', 'transport', 'other_expense']],
  ])('?type=%s 只回該類型', async (type, expected) => {
    const res = await list(`?type=${type}`).expect(200);
    expect(codes(res.body)).toEqual(expected);
  });

  it('停用的分類不列出', async () => {
    await createCategory(prisma, 'insurance', expense, {
      sortOrder: 3,
      isActive: false,
    });
    const res = await list('?type=expense').expect(200);
    expect(codes(res.body)).not.toContain('insurance');
  });

  it('看不到別人的自訂分類', async () => {
    const otherId = await createUser(prisma, 'c-other@example.com');
    await createCategory(prisma, 'other_users_pet', expense, {
      userId: otherId,
    });
    const res = await list().expect(200);
    expect(codes(res.body)).not.toContain('other_users_pet');
  });

  it('沒有任何分類：items 是空陣列', async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'c-categories@example.com');
    auth = await bearer(app, userId);
    const res = await list().expect(200);
    expect(res.body).toEqual({ items: [] });
  });

  it.each(['transfer', 'Income', ''])(
    '?type=%j 不合法：400 VALIDATION_FAILED',
    async (type) => {
      const res = await list(`?type=${type}`).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
});
