import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/index.js';
import { registerUser } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { resetDb } from './utils/db.js';
import { bearer } from './utils/test-token.js';

const UNAUTHENTICATED = {
  statusCode: 401,
  code: 'AUTH_UNAUTHENTICATED',
  message: '請先登入',
  details: [],
};

// 全域 ValidationPipe（INF-4）之後，不合法的 body 會先回 400，要送合法的值才會走到 501
const ONBOARDING_BODY = { monthlySpending: 40000 };

const NOT_IMPLEMENTED = {
  statusCode: 501,
  code: 'NOT_IMPLEMENTED',
  details: [],
};

/**
 * AUTH-1：全域 JWT guard，以及問卷、目標還沒實作的空殼（W4 實作後，501 的測試改成實際行為）。
 * GET／PATCH /goal 已實作：測試用的使用者沒有目標，帶 token 會回 409 ONBOARDING_REQUIRED（行為在 goals.e2e-spec.ts）。
 * 註冊、登入、/auth/me 的行為在 auth-flow.e2e-spec.ts。
 */
describe('登入驗證與問卷、目標空殼（e2e）', () => {
  let app: INestApplication<App>;
  let auth: string;

  beforeAll(async () => {
    app = await createTestApp();
    auth = await bearer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('公開端點：不帶 token 也能呼叫（不是 401）', () => {
    it.each([
      ['post', '/api/v1/auth/register'],
      ['post', '/api/v1/auth/login'],
    ] as const)('%s %s 沒送內容回 400，不是 401', async (method, path) => {
      const res = await request(app.getHttpServer())[method](path).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('/health 不需要登入', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect([200, 503]).toContain(res.status);
    });
  });

  describe('需要登入的端點', () => {
    // body 都送合法的內容：有全域 ValidationPipe（INF-4）之後，不合法的 body 會先回 400
    const protectedRoutes = [
      ['get', '/api/v1/auth/me', undefined],
      ['post', '/api/v1/onboarding', ONBOARDING_BODY],
      ['get', '/api/v1/goal', undefined],
      ['patch', '/api/v1/goal', undefined],
      ['get', '/api/v1/goal/progress', undefined],
      ['get', '/api/v1/loans', undefined],
    ] as const;

    it.each(protectedRoutes)(
      '%s %s 不帶 token 回 401',
      async (method, path, body) => {
        const res = await request(app.getHttpServer())
          [method](path)
          .send(body)
          .expect(401);
        expect(res.body).toMatchObject(UNAUTHENTICATED);
      },
    );

    it.each([protectedRoutes[1], protectedRoutes[4]])(
      '%s %s 帶 token 回 501（還沒實作）',
      async (method, path, body) => {
        const res = await request(app.getHttpServer())
          [method](path)
          .set('Authorization', auth)
          .send(body)
          .expect(501);
        expect(res.body).toMatchObject(NOT_IMPLEMENTED);
      },
    );

    it.each(protectedRoutes.slice(2, 4))(
      '%s %s 帶 token、沒做問卷 → 409 ONBOARDING_REQUIRED（不是 401）',
      async (method, path, body) => {
        const res = await request(app.getHttpServer())
          [method](path)
          .set('Authorization', auth)
          .send(body)
          .expect(409);
        expect(res.body).toMatchObject({ code: 'ONBOARDING_REQUIRED' });
      },
    );
  });

  describe('不合格的 token 一律回 401 AUTH_UNAUTHENTICATED', () => {
    // AUTH-1（E）：token 的 sub 用資料庫裡真的有的使用者。用 TEST_USER_ID 的話，就算 guard 放行，
    // /auth/me 也會因為「使用者不存在」回 401，測試會在 guard 壞掉時照樣通過。
    let userId: string;
    const sign = (
      payload: object,
      options?: { algorithm: 'HS512' },
    ): Promise<string> =>
      new JwtService({ secret: process.env.JWT_SECRET }).signAsync(
        payload,
        options,
      );

    beforeAll(async () => {
      userId = (await registerUser(app)).id;
    });

    afterAll(async () => {
      await resetDb(app.get(PrismaService));
    });

    it('對照組：同一把金鑰、HS256、真的使用者 → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${await sign({ sub: userId })}`)
        .expect(200);
    });

    async function expect401(authorization: string): Promise<void> {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', authorization)
        .expect(401);
      expect(res.body).toMatchObject(UNAUTHENTICATED);
    }

    it('不是 Bearer 開頭', async () => {
      await expect401(auth.replace('Bearer ', 'Basic '));
    });

    it('亂碼', async () => {
      await expect401('Bearer not-a-jwt');
    });

    it('別的金鑰簽的', async () => {
      const token = await new JwtService({
        secret: 'someone-else-insecure',
      }).signAsync({ sub: userId });
      await expect401(`Bearer ${token}`);
    });

    it('已經過期', async () => {
      const token = await sign({
        sub: userId,
        exp: Math.floor(Date.now() / 1000) - 10,
      });
      await expect401(`Bearer ${token}`);
    });

    // AUTH-1（E）：簽章正確，但內容或演算法不對
    it.each([
      ['沒有 sub', { foo: 'bar' }],
      ['sub 是空字串', { sub: '' }],
    ])('簽章正確但%s', async (_, payload) => {
      await expect401(`Bearer ${await sign(payload)}`);
    });

    it('同一把金鑰、但用 HS512 簽（只接受 HS256）', async () => {
      const token = await sign({ sub: userId }, { algorithm: 'HS512' });
      await expect401(`Bearer ${token}`);
    });
  });

  it('bearer 小寫也接受', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/goal')
      .set('Authorization', auth.replace('Bearer', 'bearer'))
      .expect(409);
  });

  it('不存在的路徑仍然回 404，不是 401（guard 只在找到端點後才執行）', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/no-such-route')
      .expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
