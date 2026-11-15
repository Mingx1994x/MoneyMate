import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/index.js';
import { loginUser, registerUser } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { TEST_USER_ID } from './utils/test-token.js';

const PASSWORD = 'correct-horse-battery';

const INVALID_CREDENTIALS = {
  statusCode: 401,
  code: 'AUTH_INVALID_CREDENTIALS',
  message: 'Email 或密碼錯誤',
  details: [],
};

/**
 * AUTH-2：註冊、登入、/auth/me（PRD 最小流程 ①、AC-01）。
 * 次數限制在 auth-ip-limit、auth-email-limit 兩個檔案（要用不同的環境變數）。
 * 欄位規則的各種邊界在 dto/auth-dtos.spec.ts（單元）；這裡的「輸入驗證」只確認全域
 * ValidationPipe（INF-4）真的套在註冊、登入上（AUTH-1，E）。
 */
describe('註冊、登入、/auth/me（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const register = (body: object): request.Test =>
    request(app.getHttpServer()).post('/api/v1/auth/register').send(body);
  const login = (email: string, password: string): request.Test =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });
  const me = (token: string): request.Test =>
    request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE users CASCADE');
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe('TRUNCATE users CASCADE');
    await app?.close();
  });

  describe('註冊', () => {
    it('成功：回 201、token 和使用者資料，回應不含任何密碼資訊', async () => {
      const res = await register({
        email: 'shin@example.com',
        password: PASSWORD,
        displayName: 'Shin',
      }).expect(201);
      expect(res.body).toEqual({
        accessToken: expect.any(String) as string,
        user: {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
          email: 'shin@example.com',
          displayName: 'Shin',
          hasCompletedOnboarding: false,
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
    });

    it('資料庫存的是 bcrypt 雜湊，不是密碼原文', async () => {
      await register({ email: 'hash@example.com', password: PASSWORD }).expect(
        201,
      );
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'hash@example.com' },
      });
      expect(user.passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);
    });

    it('註冊回傳的 token 可以直接呼叫 /auth/me', async () => {
      const res = await register({
        email: 'me@example.com',
        password: PASSWORD,
      }).expect(201);
      const body = res.body as { accessToken: string; user: { id: string } };
      const meRes = await me(body.accessToken).expect(200);
      expect(meRes.body).toEqual({
        id: body.user.id,
        email: 'me@example.com',
        displayName: null,
        hasCompletedOnboarding: false,
      });
    });

    it('Email 去除前後空白、轉成小寫後儲存', async () => {
      const res = await register({
        email: '  Shin.Huang@Example.COM ',
        password: PASSWORD,
      }).expect(201);
      expect((res.body as { user: { email: string } }).user.email).toBe(
        'shin.huang@example.com',
      );
    });

    it('displayName 沒填或只有空白：存成 null', async () => {
      const res = await register({
        email: 'blank@example.com',
        password: PASSWORD,
        displayName: '   ',
      }).expect(201);
      expect(
        (res.body as { user: { displayName: unknown } }).user.displayName,
      ).toBeNull();
    });

    it('Email 已經註冊過（大小寫不同也算）→ 409 AUTH_EMAIL_TAKEN，details 指向 email', async () => {
      await register({ email: 'dup@example.com', password: PASSWORD }).expect(
        201,
      );
      const res = await register({
        email: 'DUP@example.com',
        password: 'another-password',
      }).expect(409);
      expect(res.body).toMatchObject({
        code: 'AUTH_EMAIL_TAKEN',
        message: '這個 Email 已經註冊過了',
        details: [{ field: 'email', code: 'AUTH_EMAIL_TAKEN' }],
      });
      expect(await prisma.user.count()).toBe(1);
    });

    it('兩個請求同時註冊同一個 Email：只有一個成功，另一個 409', async () => {
      const [a, b] = await Promise.all([
        register({ email: 'race@example.com', password: PASSWORD }),
        register({ email: 'race@example.com', password: PASSWORD }),
      ]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe('登入', () => {
    beforeEach(async () => {
      await register({ email: 'login@example.com', password: PASSWORD }).expect(
        201,
      );
    });

    it('成功：回 200（不是 201）和 token，Email 大小寫不同也可以', async () => {
      const res = await login('LOGIN@Example.com', PASSWORD).expect(200);
      const body = res.body as { accessToken: string; user: { email: string } };
      expect(body.user.email).toBe('login@example.com');
      await me(body.accessToken).expect(200);
    });

    it('密碼錯誤 → 401 AUTH_INVALID_CREDENTIALS', async () => {
      const res = await login('login@example.com', 'wrong-password').expect(
        401,
      );
      expect(res.body).toMatchObject(INVALID_CREDENTIALS);
    });

    it('Email 不存在 → 和密碼錯誤完全一樣的回應（不透露 Email 有沒有註冊）', async () => {
      const unknown = await login('nobody@example.com', PASSWORD).expect(401);
      const wrong = await login('login@example.com', 'wrong-password').expect(
        401,
      );
      const strip = (body: object): object => ({
        ...body,
        requestId: undefined,
      });
      expect(strip(unknown.body as object)).toEqual(
        strip(wrong.body as object),
      );
    });

    it('前 72 bytes 相同、後面多打字的密碼不能登入（bcrypt 只看前 72 bytes）', async () => {
      const long = 'a'.repeat(72);
      await register({ email: 'long@example.com', password: long }).expect(201);
      await login('long@example.com', long).expect(200);
      await login('long@example.com', `${long}extra`).expect(401);
    });
  });

  describe('輸入驗證（AUTH-1）', () => {
    it.each([
      ['密碼 7 字元', { password: '1234567' }, 'password'],
      // 字數沒超過 72，但 UTF-8 是 75 bytes（bcrypt 只看前 72 bytes）
      ['密碼 25 個中文字', { password: '密'.repeat(25) }, 'password'],
      // 沒擋的話會撞資料庫 email = lower(email) 的 CHECK，變成 500
      ['Email 含非 ASCII 字元', { email: 'İnfo@example.com' }, 'email'],
    ])('註冊：%s → 400，沒有寫進資料庫', async (_, override, field) => {
      const res = await register({
        email: 'invalid@example.com',
        password: PASSWORD,
        ...override,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field }],
      });
      expect(await prisma.user.count()).toBe(0);
    });

    it('註冊：多送 id、passwordHash → 400，不能自己指定', async () => {
      const res = await register({
        email: 'extra@example.com',
        password: PASSWORD,
        id: TEST_USER_ID,
        passwordHash: 'x',
      }).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await prisma.user.count()).toBe(0);
    });

    // LoginDto 刻意只檢查有沒有填：格式或長度不對也回帳密錯誤，不另外回 400
    it.each([
      ['Email 格式不對', 'not-an-email', PASSWORD],
      ['密碼 7 字元', 'someone@example.com', '1234567'],
    ])(
      '登入：%s → 401 AUTH_INVALID_CREDENTIALS，不是 400',
      async (_, email, password) => {
        const res = await login(email, password).expect(401);
        expect(res.body).toMatchObject(INVALID_CREDENTIALS);
      },
    );
  });

  describe('token 內容（AUTH-1）', () => {
    it('登入拿到的 token 只帶 sub、iat、exp，有效 24 小時', async () => {
      const user = await registerUser(app);
      const auth = await loginUser(app, user.email, user.password);
      // 直接解開送出去的 token，不經過 JwtService
      const [, part] = auth.replace(/^Bearer /, '').split('.');
      const payload = JSON.parse(
        Buffer.from(part, 'base64url').toString('utf8'),
      ) as { sub: string; iat: number; exp: number };
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
      expect(payload.sub).toBe(user.id);
      expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
    });
  });

  describe('/auth/me', () => {
    it('完成問卷（有目標資料）後 hasCompletedOnboarding 是 true', async () => {
      const res = await register({
        email: 'goal@example.com',
        password: PASSWORD,
      }).expect(201);
      const body = res.body as { accessToken: string; user: { id: string } };
      await prisma.goal.create({
        data: {
          userId: body.user.id,
          monthlySpending: 40000,
          targetAmount: 12000000,
        },
      });
      const meRes = await me(body.accessToken).expect(200);
      expect(
        (meRes.body as { hasCompletedOnboarding: boolean })
          .hasCompletedOnboarding,
      ).toBe(true);
    });

    it('token 對應的使用者已經不存在 → 401 AUTH_UNAUTHENTICATED', async () => {
      const res = await register({
        email: 'gone@example.com',
        password: PASSWORD,
      }).expect(201);
      const body = res.body as { accessToken: string };
      await prisma.$executeRawUnsafe('TRUNCATE users CASCADE');
      const meRes = await me(body.accessToken).expect(401);
      expect(meRes.body).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    });
  });
});
