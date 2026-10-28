import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { bearer } from './utils/test-token.js';

/**
 * dashboard 空殼：回 501。
 * AUTH-1 之後要帶 token，否則 guard 先回 401（沒帶 token 的情況在 auth.e2e-spec.ts）。
 */
describe('Dashboard 空殼（e2e）', () => {
  let app: INestApplication<App>;
  let auth: string;

  beforeAll(async () => {
    app = await createTestApp();
    auth = await bearer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    '/api/v1/dashboard/summary',
    '/api/v1/dashboard/summary?month=2026-10',
  ])('get %s 回 501 NOT_IMPLEMENTED', async (path) => {
    const res = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', auth)
      .expect(501);
    expect(res.body).toMatchObject({
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
      details: [],
    });
  });
});
