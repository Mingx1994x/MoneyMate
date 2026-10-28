import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';

/**
 * dashboard 空殼：回 501。
 * AUTH-1 加上 guard 後，沒帶 token 會先回 401，這裡要改成帶 token（C 的 test/utils/auth.ts）。
 */
describe('Dashboard 空殼（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    '/api/v1/dashboard/summary',
    '/api/v1/dashboard/summary?month=2026-10',
  ])('get %s 回 501 NOT_IMPLEMENTED', async (path) => {
    const res = await request(app.getHttpServer()).get(path).expect(501);
    expect(res.body).toMatchObject({
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
      details: [],
    });
  });
});
