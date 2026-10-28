import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { bearer } from './utils/test-token.js';

const ID = '5c4b3a29-1807-4f6e-8d5c-4b3a29180765';

/**
 * transactions 空殼：全部端點回 501。
 * AUTH-1 之後要帶 token，否則 guard 先回 401（沒帶 token 的情況在 auth.e2e-spec.ts）。
 */
describe('交易空殼（e2e）', () => {
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
    ['get', '/api/v1/transactions'],
    ['post', '/api/v1/transactions'],
    ['get', `/api/v1/transactions/${ID}`],
    ['patch', `/api/v1/transactions/${ID}`],
    ['delete', `/api/v1/transactions/${ID}`],
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

  it.each(['get', 'patch', 'delete'] as const)(
    '%s 的 :id 不是 UUID 時回 404 TRANSACTION_NOT_FOUND',
    async (method) => {
      const res = await request(app.getHttpServer())
        [method]('/api/v1/transactions/not-a-uuid')
        .set('Authorization', auth)
        .expect(404);
      expect(res.body).toMatchObject({
        code: 'TRANSACTION_NOT_FOUND',
        message: '找不到這筆交易',
        details: [],
      });
    },
  );
});
