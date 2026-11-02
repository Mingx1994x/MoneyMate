import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/index.js';

const PASSWORD = 'correct-horse-battery';

// AUTH_IP_LIMIT_PER_MINUTE=3 獨立一個檔案：@nestjs/config 在 import AppModule 時就存下環境變數，
// 同一個檔案換不了值。stubEnv 之後才動態 import createTestApp（照 trust-proxy.e2e-spec.ts）。
describe('每個 IP 的次數限制（e2e，PRD FR-03）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const register = (email: string): request.Test =>
    request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });

  beforeAll(async () => {
    vi.stubEnv('AUTH_IP_LIMIT_PER_MINUTE', '3');
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
});
