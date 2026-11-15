import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { IpTestController } from './utils/ip-test.controller.js';

describe('骨架（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [IpTestController] });
  });

  afterAll(async () => {
    // createTestApp 丟錯時 app 沒建立，不要再多報一個錯
    await app?.close();
  });

  it('GET /health 連得到資料庫時回 200，且不加 /api/v1 前綴', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', db: 'ok' });
    await request(app.getHttpServer()).get('/api/v1/health').expect(404);
  });

  it('CORS：允許 CORS_ORIGIN 的預檢，其他來源不回 Access-Control-Allow-Origin', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );

    const denied = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('一般回應帶安全標頭，沒有 X-Powered-By', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS 預檢也帶安全標頭（安全標頭要在 enableCors 之前掛上）', async () => {
    const res = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    // 確認是 cors 結束的預檢回應（走到 Nest 的 404 本來就帶安全標頭，會因為錯的理由通過）
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  // TRUST_PROXY_HOPS=1 的案例在 trust-proxy.e2e-spec.ts
  it('TRUST_PROXY_HOPS=0（預設）：不採用 X-Forwarded-For', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/__ip-test')
      .set('X-Forwarded-For', '1.2.3.4')
      .expect(200);
    const { ip } = res.body as { ip: string };
    expect(ip).toBeDefined();
    expect(ip).not.toBe('1.2.3.4');
  });

  it('測試程序的時區是 UTC', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});

describe('/health 資料庫連不到（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(PrismaService).useValue({
          $queryRaw: () => Promise.reject(new Error('connect ECONNREFUSED')),
        }),
    });
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('回 503，body 剛好是 { status, db }（沒有 requestId，沒經過全域 filter）', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
  });
});
