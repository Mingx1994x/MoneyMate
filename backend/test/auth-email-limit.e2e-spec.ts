import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { PrismaService } from '../src/prisma/index.js';
import { FakeClock } from './utils/fake-clock.js';

const PASSWORD = 'correct-horse-battery';

// 失敗上限 2 次、視窗 900 秒：獨立一個檔案（環境變數要在 import AppModule 之前設好）。
// 時間用 FakeClock 控制，不用真的等 15 分鐘。
describe('每個 Email 的登入失敗限制（e2e，PRD FR-03）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = new FakeClock('2026-10-29T02:00:00Z');

  const login = (email: string, password: string): request.Test =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });
  const register = (email: string): request.Test =>
    request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });

  beforeAll(async () => {
    vi.stubEnv('LOGIN_FAILURE_LIMIT', '2');
    vi.stubEnv('LOGIN_FAILURE_WINDOW_SECONDS', '900');
    const { createTestApp } = await import('./utils/create-test-app.js');
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE users CASCADE');
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe('TRUNCATE users CASCADE');
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('失敗 2 次後鎖住：第 3 次即使密碼正確也回 429，帶剩下的秒數；別的 Email 不受影響', async () => {
    await register('lock@example.com').expect(201);
    await register('other@example.com').expect(201);

    await login('lock@example.com', 'wrong-1').expect(401);
    await login('lock@example.com', 'wrong-2').expect(401);
    clock.set('2026-10-29T02:05:00Z'); // 過了 5 分鐘，還在 15 分鐘的視窗內
    const blocked = await login('lock@example.com', PASSWORD).expect(429);
    expect(blocked.body).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      retryAfterSeconds: 600,
    });

    await login('other@example.com', PASSWORD).expect(200);
  });

  it('同時送出多個錯誤密碼，也只有上限次數會比對密碼', async () => {
    await register('burst@example.com').expect(201);
    const res = await Promise.all(
      Array.from({ length: 10 }, () => login('burst@example.com', 'wrong')),
    );
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(2);
    expect(statuses.filter((s) => s === 429)).toHaveLength(8);
  });

  it('視窗結束後解鎖，密碼正確就能登入', async () => {
    clock.set('2026-10-29T03:00:00Z');
    await register('expire@example.com').expect(201);
    await login('expire@example.com', 'wrong').expect(401);
    await login('expire@example.com', 'wrong').expect(401);
    await login('expire@example.com', PASSWORD).expect(429);

    clock.set('2026-10-29T03:15:00Z'); // 剛好 900 秒
    await login('expire@example.com', PASSWORD).expect(200);
  });

  it('登入成功會把失敗次數歸零', async () => {
    await register('reset@example.com').expect(201);
    await login('reset@example.com', 'wrong').expect(401);
    await login('reset@example.com', PASSWORD).expect(200);
    // 歸零了：這次是第 1 次失敗，不會被鎖
    await login('reset@example.com', 'wrong').expect(401);
    await login('reset@example.com', PASSWORD).expect(200);
  });

  it('Email 大小寫不同算同一個', async () => {
    await register('case@example.com').expect(201);
    await login('CASE@example.com', 'wrong').expect(401);
    await login('case@EXAMPLE.com', 'wrong').expect(401);
    await login('case@example.com', PASSWORD).expect(429);
  });

  it('不存在的 Email 也會被鎖：從 429 看不出 Email 有沒有註冊', async () => {
    await login('ghost@example.com', 'wrong').expect(401);
    await login('ghost@example.com', 'wrong').expect(401);
    const res = await login('ghost@example.com', 'wrong').expect(429);
    expect(res.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
