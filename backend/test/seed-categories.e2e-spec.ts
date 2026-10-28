import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/index.js';
import {
  SYSTEM_CATEGORIES,
  seedSystemCategories,
} from '../src/seed/system-categories.js';
import { createTestApp } from './utils/create-test-app.js';

/** 系統分類 seed（FR-12）：要能重複執行，而且不動使用者的資料 */
describe('系統分類 seed（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const run = (): Promise<number> =>
    prisma.$transaction((tx) => seedSystemCategories(tx));

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE users, categories CASCADE');
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe('TRUNCATE users, categories CASCADE');
    await app?.close();
  });

  it('空的資料庫：建立 12 個系統分類（user_id 是 null、啟用中）', async () => {
    expect(await run()).toBe(12);
    const rows = await prisma.category.findMany({ orderBy: { code: 'asc' } });
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.userId === null && r.isActive)).toBe(true);
    expect(rows.map((r) => r.code).sort()).toEqual(
      SYSTEM_CATEGORIES.map((c) => c.code).sort(),
    );
    const food = rows.find((r) => r.code === 'food');
    expect(food).toMatchObject({ name: '飲食', type: 'expense', sortOrder: 1 });
  });

  it('重複執行：還是 12 個，id 不變', async () => {
    await run();
    const before = await prisma.category.findMany({ orderBy: { code: 'asc' } });
    await run();
    await run();
    const after = await prisma.category.findMany({ orderBy: { code: 'asc' } });
    expect(after).toHaveLength(12);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it('名稱、順序被改掉後，重跑會改回來', async () => {
    await run();
    await prisma.category.update({
      where: { code: 'food' },
      data: { name: '亂改', sortOrder: 50 },
    });
    await run();
    expect(
      await prisma.category.findUnique({ where: { code: 'food' } }),
    ).toMatchObject({
      name: '飲食',
      sortOrder: 1,
    });
  });

  it('被停用的分類，重跑不會又打開', async () => {
    await run();
    await prisma.category.update({
      where: { code: 'tax' },
      data: { isActive: false },
    });
    await run();
    expect(
      (await prisma.category.findUnique({ where: { code: 'tax' } }))?.isActive,
    ).toBe(false);
  });

  it('不會刪除或改動別的分類，也不會動使用者的資料', async () => {
    const user = await prisma.user.create({
      data: { email: 'seed-check@test.local', passwordHash: 'x' },
    });
    const custom = await prisma.category.create({
      data: {
        userId: user.id,
        code: 'my_custom',
        name: '我的分類',
        type: 'expense',
      },
    });
    await run();
    expect(await prisma.category.count()).toBe(13);
    expect(
      await prisma.category.findUnique({ where: { id: custom.id } }),
    ).toMatchObject({ code: 'my_custom', name: '我的分類', userId: user.id });
    expect(await prisma.user.count()).toBe(1);
  });

  it('code 已經是使用者的分類時丟錯，而且整個交易回滾（不會留下半套）', async () => {
    const user = await prisma.user.create({
      data: { email: 'seed-clash@test.local', passwordHash: 'x' },
    });
    // 'transport' 排在 'salary'、'food' 之後：前面的分類已經寫入才碰到衝突
    await prisma.category.create({
      data: {
        userId: user.id,
        code: 'transport',
        name: '使用者的',
        type: 'expense',
      },
    });
    await expect(run()).rejects.toThrow(/transport/);
    const rows = await prisma.category.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'transport', name: '使用者的' });
  });
});
