import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { bearer } from './utils/test-token.js';

const ID = '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10';

/**
 * LOAN-1 空殼：全部端點回 501。
 * AUTH-1 之後要帶 token，否則 guard 先回 401（沒帶 token 的情況在 auth.e2e-spec.ts）。
 */
describe('貸款空殼（e2e）', () => {
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
    ['get', '/api/v1/loans/payment-preview'],
    ['get', '/api/v1/loans'],
    ['post', '/api/v1/loans'],
    ['get', `/api/v1/loans/${ID}`],
    ['patch', `/api/v1/loans/${ID}`],
    ['delete', `/api/v1/loans/${ID}`],
  ] as const)('%s %s 回 501 NOT_IMPLEMENTED', async (method, path) => {
    const res = await request(app.getHttpServer())
      [method](path)
      .set('Authorization', auth)
      .expect(501);
    expect(res.body).toMatchObject({
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
      details: [],
    });
  });

  it('payment-preview 宣告在 :id 之前：回 501，不是被 :id 接走的 404', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/loans/payment-preview')
      .set('Authorization', auth)
      .expect(501);
  });

  it.each(['get', 'patch', 'delete'] as const)(
    '%s 的 :id 不是 UUID 時回 404 LOAN_NOT_FOUND',
    async (method) => {
      const res = await request(app.getHttpServer())
        [method]('/api/v1/loans/not-a-uuid')
        .set('Authorization', auth)
        .expect(404);
      expect(res.body).toMatchObject({
        code: 'LOAN_NOT_FOUND',
        message: '找不到這筆貸款',
        details: [],
      });
    },
  );
});
