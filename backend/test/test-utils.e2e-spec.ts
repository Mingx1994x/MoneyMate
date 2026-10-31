import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/index.js';
import { SYSTEM_CATEGORIES } from '../src/seed/system-categories.js';
import { loginUser, registerUser, uniqueEmail } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { resetDb, seedCategories } from './utils/db.js';

/** 整合測試工具自己的測試：確認組員拿去用的 helper 真的能用 */
describe('測試工具（test/utils）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  it('uniqueEmail：每次都不一樣，而且是小寫', () => {
    const a = uniqueEmail();
    const b = uniqueEmail();
    expect(a).not.toBe(b);
    expect(a).toBe(a.toLowerCase());
  });

  it('registerUser：真的建出使用者，token 可以呼叫需要登入的端點', async () => {
    const user = await registerUser(app);
    const inDb = await prisma.user.findUnique({ where: { id: user.id } });
    expect(inDb?.email).toBe(user.email);

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', user.auth)
      .expect(200);
    expect(res.body).toMatchObject({ id: user.id, email: user.email });
  });

  it('loginUser：同一個使用者重新登入，拿到能用的新 token', async () => {
    const user = await registerUser(app);
    const auth = await loginUser(app, user.email, user.password);
    expect(auth).toMatch(/^Bearer /);
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', auth)
      .expect(200);
    expect(res.body).toMatchObject({ id: user.id });
  });

  it('registerUser 失敗時丟出帶狀態碼的錯誤（例如 Email 重複）', async () => {
    const user = await registerUser(app);
    await expect(registerUser(app, { email: user.email })).rejects.toThrow(
      /registerUser 失敗：409/,
    );
  });

  it('seedCategories：建出 12 個系統分類，回傳 code → id，可以重複呼叫', async () => {
    const first = await seedCategories(prisma);
    const again = await seedCategories(prisma);
    expect(Object.keys(first).sort()).toEqual(
      SYSTEM_CATEGORIES.map((c) => c.code).sort(),
    );
    expect(again).toEqual(first);

    // 跟分類 API 看到的一樣
    const user = await registerUser(app);
    const res = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Authorization', user.auth)
      .expect(200);
    expect((res.body as { items: unknown[] }).items).toHaveLength(12);
  });
});
