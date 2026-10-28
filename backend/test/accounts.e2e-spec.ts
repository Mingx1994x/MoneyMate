import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { bearer } from './utils/test-token.js';

const ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

// 全域 ValidationPipe（INF-4）之後，不合法的 body 會先回 400，要送合法的值才會走到 501
const CREATE_BODY = {
  name: '台新銀行',
  accountType: 'bank',
  openingBalance: '100000.00',
};

/**
 * accounts 空殼：全部端點回 501。
 * AUTH-1 之後要帶 token，否則 guard 先回 401（沒帶 token 的情況在 auth.e2e-spec.ts）。
 */
describe('帳戶空殼（e2e）', () => {
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
    ['get', '/api/v1/accounts', undefined],
    ['post', '/api/v1/accounts', CREATE_BODY],
    ['get', `/api/v1/accounts/${ID}`, undefined],
    ['patch', `/api/v1/accounts/${ID}`, { name: '台新銀行' }],
    ['delete', `/api/v1/accounts/${ID}`, undefined],
  ] as const)('%s %s 回 501 NOT_IMPLEMENTED', async (method, path, body) => {
    const res = await request(app.getHttpServer())
      [method](path)
      .set('Authorization', auth)
      .send(body)
      .expect(501);
    expect(res.body).toMatchObject({
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
      details: [],
    });
  });

  it.each(['get', 'patch', 'delete'] as const)(
    '%s 的 :id 不是 UUID 時回 404 ACCOUNT_NOT_FOUND',
    async (method) => {
      const res = await request(app.getHttpServer())
        [method]('/api/v1/accounts/not-a-uuid')
        .set('Authorization', auth)
        .expect(404);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_NOT_FOUND',
        message: '找不到這個帳戶',
        details: [],
      });
    },
  );
});
