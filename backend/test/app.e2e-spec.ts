import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';

describe('骨架（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    // createTestApp 丟錯時 app 沒建立，不要再多報一個錯
    await app?.close();
  });

  it('GET /health 回 200，且不加 /api/v1 前綴', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
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
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('測試程序的時區是 UTC', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});
