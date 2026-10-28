import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { bearer, TEST_USER_ID } from './utils/test-token.js';

const UNAUTHENTICATED = {
  statusCode: 401,
  code: 'AUTH_UNAUTHENTICATED',
  message: '請先登入',
  details: [],
};

// 全域 ValidationPipe（INF-4）之後，不合法的 body 會先回 400，要送合法的值才會走到 501
const REGISTER_BODY = {
  email: 'shin@example.com',
  password: 'correct-horse-battery',
};
const LOGIN_BODY = REGISTER_BODY;
const ONBOARDING_BODY = { monthlySpending: 40000 };

const NOT_IMPLEMENTED = {
  statusCode: 501,
  code: 'NOT_IMPLEMENTED',
  details: [],
};

/**
 * AUTH-1：全域 JWT guard，以及 auth、onboarding、goal 的空殼。
 * 空殼的端點實作後（AUTH-2、W4），501 的測試改成實際行為。
 */
describe('登入驗證與 D 的空殼（e2e）', () => {
  let app: INestApplication<App>;
  let auth: string;

  beforeAll(async () => {
    app = await createTestApp();
    auth = await bearer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('公開端點：不帶 token 也能呼叫', () => {
    it.each([
      ['post', '/api/v1/auth/register', REGISTER_BODY],
      ['post', '/api/v1/auth/login', LOGIN_BODY],
    ] as const)('%s %s 回 501（不是 401）', async (method, path, body) => {
      const res = await request(app.getHttpServer())
        [method](path)
        .send(body)
        .expect(501);
      expect(res.body).toMatchObject(NOT_IMPLEMENTED);
    });

    it('/health 不需要登入', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect([200, 503]).toContain(res.status);
    });
  });

  describe('需要登入的端點', () => {
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
      async (method, path) => {
        const res = await request(app.getHttpServer())
          [method](path)
          .expect(401);
        expect(res.body).toMatchObject(UNAUTHENTICATED);
      },
    );

    it.each(protectedRoutes.slice(0, 5))(
      '%s %s 帶 token 回 501',
      async (method, path, body) => {
        const res = await request(app.getHttpServer())
          [method](path)
          .set('Authorization', auth)
          .send(body)
          .expect(501);
        expect(res.body).toMatchObject(NOT_IMPLEMENTED);
      },
    );
  });

  describe('不合格的 token 一律回 401 AUTH_UNAUTHENTICATED', () => {
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
      }).signAsync({ sub: TEST_USER_ID });
      await expect401(`Bearer ${token}`);
    });

    it('已經過期', async () => {
      const token = await new JwtService({
        secret: process.env.JWT_SECRET,
      }).signAsync({
        sub: TEST_USER_ID,
        exp: Math.floor(Date.now() / 1000) - 10,
      });
      await expect401(`Bearer ${token}`);
    });
  });

  it('bearer 小寫也接受', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', auth.replace('Bearer', 'bearer'))
      .expect(501);
  });

  it('不存在的路徑仍然回 404，不是 401（guard 只在找到端點後才執行）', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/no-such-route')
      .expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
