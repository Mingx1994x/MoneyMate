import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';

const ID = '5c4b3a29-1807-4f6e-8d5c-4b3a29180765';

/**
 * transactions 空殼：全部端點回 501。
 * AUTH-1 加上 guard 後，沒帶 token 會先回 401，這裡要改成帶 token（C 的 test/utils/auth.ts）。
 */
describe('交易空殼（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
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
    const res = await request(app.getHttpServer())[method](path).expect(501);
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
        .expect(404);
      expect(res.body).toMatchObject({
        code: 'TRANSACTION_NOT_FOUND',
        message: '找不到這筆交易',
        details: [],
      });
    },
  );
});
