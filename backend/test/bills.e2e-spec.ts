import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';

const ID = '5c3a1e8f-7d2b-4f6a-b9e0-1d4c7a2f8b36';

/**
 * BILL-1 空殼：全部端點回 501。
 * AUTH-1 加上 guard 後，沒帶 token 會先回 401，這裡要改成帶 token（C 的 test/utils/auth.ts）。
 */
describe('帳單空殼（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['get', '/api/v1/bills'],
    ['post', '/api/v1/bills'],
    ['get', `/api/v1/bills/${ID}`],
    ['patch', `/api/v1/bills/${ID}`],
    ['delete', `/api/v1/bills/${ID}`],
    ['post', `/api/v1/bills/${ID}/pay`],
    ['post', `/api/v1/bills/${ID}/unpay`],
    ['post', `/api/v1/bills/${ID}/stop-recurrence`],
  ] as const)('%s %s 回 501 NOT_IMPLEMENTED', async (method, path) => {
    const res = await request(app.getHttpServer())[method](path).expect(501);
    expect(res.body).toMatchObject({
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
      details: [],
    });
  });

  it.each([
    ['get', '/api/v1/bills/not-a-uuid'],
    ['patch', '/api/v1/bills/not-a-uuid'],
    ['delete', '/api/v1/bills/not-a-uuid'],
    ['post', '/api/v1/bills/not-a-uuid/pay'],
    ['post', '/api/v1/bills/not-a-uuid/unpay'],
    ['post', '/api/v1/bills/not-a-uuid/stop-recurrence'],
  ] as const)(
    '%s %s 回 404 BILL_NOT_FOUND（:id 不是 UUID）',
    async (method, path) => {
      const res = await request(app.getHttpServer())[method](path).expect(404);
      expect(res.body).toMatchObject({
        code: 'BILL_NOT_FOUND',
        message: '找不到這張帳單',
        details: [],
      });
    },
  );
});
