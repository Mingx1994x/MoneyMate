import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/index.js';
import { uniqueEmail } from './utils/auth.js';

const PASSWORD = 'correct-horse-battery';

// AUTH_IP_LIMIT_PER_MINUTE=3 獨立一個檔案：@nestjs/config 在 import AppModule 時就存下環境變數，
// 同一個檔案換不了值。stubEnv 之後才動態 import createTestApp（照 trust-proxy.e2e-spec.ts）。
// TRUST_PROXY_HOPS=1 和正式環境（Render 在代理後面）一樣：限流要算到使用者的 IP，不是代理的 IP。
// 沒帶 X-Forwarded-For 的請求 req.ip 仍是本機位址。
describe('每個 IP 的次數限制（e2e，PRD FR-03）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const register = (email: string): request.Test =>
    request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });

  beforeAll(async () => {
    vi.stubEnv('AUTH_IP_LIMIT_PER_MINUTE', '3');
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const { createTestApp } = await import('./utils/create-test-app.js');
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE users CASCADE');
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe('TRUNCATE users CASCADE');
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('註冊：同一個 IP 第 4 次回 429 TOO_MANY_REQUESTS，並帶 retryAfterSeconds', async () => {
    let token = '';
    for (const n of [1, 2, 3]) {
      const res = await register(`ip${n}@example.com`).expect(201);
      token = (res.body as { accessToken: string }).accessToken;
    }
    const blocked = await register('ip4@example.com').expect(429);
    expect(blocked.body).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: '操作太頻繁，請稍後再試',
      details: [],
    });
    const retry = (blocked.body as { retryAfterSeconds: number })
      .retryAfterSeconds;
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    // 被擋的那次沒有寫進資料庫
    expect(await prisma.user.count()).toBe(3);

    // 登入是另一個端點，各自計數：還沒被擋
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ip1@example.com', password: PASSWORD })
      .expect(200);

    // 次數限制只掛在註冊、登入：其他端點不受影響
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  // AUTH-1（E）：以下每條用自己的 X-Forwarded-For（TRUST_PROXY_HOPS=1），throttler 以 IP＋端點計數，
  // 各條互不影響，也不受上面那條（本機 IP）影響。C 的 registerUser 不帶這個標頭，這裡不用。
  describe('登入的上限與不同 IP（AUTH-1）', () => {
    const registerFrom = (ip: string, email: string): request.Test =>
      request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', ip)
        .send({ email, password: PASSWORD });
    const loginFrom = (ip: string, body?: object): request.Test =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send(body);

    function expectBlocked(res: request.Response): void {
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      const retry = (res.body as { retryAfterSeconds: number })
        .retryAfterSeconds;
      expect(retry).toBeGreaterThanOrEqual(1);
      expect(retry).toBeLessThanOrEqual(60);
    }

    it('登入有自己的上限，登入成功也算：第 4 次回 429', async () => {
      const email = uniqueEmail('ip-login');
      await registerFrom('10.0.1.1', email).expect(201);
      for (let i = 0; i < 3; i += 1) {
        await loginFrom('10.0.1.2', { email, password: PASSWORD }).expect(200);
      }
      expectBlocked(await loginFrom('10.0.1.2', { email, password: PASSWORD }));
    });

    it('登入失敗也算：每個 Email 只失敗 1 次（不是 Email 鎖定），第 4 次仍回 429', async () => {
      for (let i = 0; i < 3; i += 1) {
        await loginFrom('10.0.2.1', {
          email: uniqueEmail('ip-fail'),
          password: PASSWORD,
        }).expect(401);
      }
      expectBlocked(
        await loginFrom('10.0.2.1', {
          email: uniqueEmail('ip-fail'),
          password: PASSWORD,
        }),
      );
    });

    it('沒送 body 也算次數：guard 在驗證之前執行', async () => {
      for (let i = 0; i < 3; i += 1) {
        await loginFrom('10.0.3.1').expect(400);
      }
      expectBlocked(await loginFrom('10.0.3.1'));
    });

    it('不同 IP 分開計算', async () => {
      for (let i = 0; i < 3; i += 1) {
        await registerFrom('10.0.4.1', uniqueEmail('ip-a')).expect(201);
      }
      expectBlocked(await registerFrom('10.0.4.1', uniqueEmail('ip-a')));
      await registerFrom('10.0.4.2', uniqueEmail('ip-b')).expect(201);
    });

    it('X-Forwarded-For 前段每次換也沒用：只認代理加上的最後一段', async () => {
      for (let i = 0; i < 3; i += 1) {
        await registerFrom(
          `6.6.6.${i}, 10.0.5.1`,
          uniqueEmail('ip-fake'),
        ).expect(201);
      }
      expectBlocked(
        await registerFrom('6.6.6.9, 10.0.5.1', uniqueEmail('ip-fake')),
      );
    });
  });
});
