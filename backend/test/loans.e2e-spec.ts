import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';

const ID = '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10';

/**
 * LOAN-1 空殼：全部端點回 501。
 * AUTH-1 加上 guard 後，沒帶 token 會先回 401，這裡要改成帶 token（C 的 test/utils/auth.ts）。
 */
describe('貸款空殼（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
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
    const res = await request(app.getHttpServer())[method](path).expect(501);
    expect(res.body).toMatchObject({
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
      details: [],
    });
  });

  it('payment-preview 宣告在 :id 之前：回 501，不是被 :id 接走的 404', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/loans/payment-preview')
      .expect(501);
  });

  it.each(['get', 'patch', 'delete'] as const)(
    '%s 的 :id 不是 UUID 時回 404 LOAN_NOT_FOUND',
    async (method) => {
      const res = await request(app.getHttpServer())
        [method]('/api/v1/loans/not-a-uuid')
        .expect(404);
      expect(res.body).toMatchObject({
        code: 'LOAN_NOT_FOUND',
        message: '找不到這筆貸款',
        details: [],
      });
    },
  );
});
