import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { bearer } from './utils/test-token.js';

const ID = '5c3a1e8f-7d2b-4f6a-b9e0-1d4c7a2f8b36';

// 全域 ValidationPipe（INF-4）之後，不合法的 body 會先回 400，要送合法的值才會走到 501
const CREATE_BODY = {
  name: '房租',
  amount: '15000.00',
  categoryId: '0b8d3c7e-2f4a-4e6b-9c1d-5a7f8e9b0c21',
  accountId: '9e2f6a14-3b7c-4d8e-a5f1-6c0b2d4e8a73',
  dueDate: '2026-11-01',
};

/**
 * BILL-1 空殼：全部端點回 501。
 * AUTH-1 之後要帶 token，否則 guard 先回 401（沒帶 token 的情況在 auth.e2e-spec.ts）。
 */
describe('帳單空殼（e2e）', () => {
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
    ['get', '/api/v1/bills', undefined],
    ['post', '/api/v1/bills', CREATE_BODY],
    ['get', `/api/v1/bills/${ID}`, undefined],
    ['patch', `/api/v1/bills/${ID}`, { name: '房租' }],
    ['delete', `/api/v1/bills/${ID}`, undefined],
    ['post', `/api/v1/bills/${ID}/pay`, undefined],
    ['post', `/api/v1/bills/${ID}/unpay`, undefined],
    ['post', `/api/v1/bills/${ID}/stop-recurrence`, { keepCurrent: true }],
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

  it.each([
    [
      'POST 的金額送 JSON 數字',
      'post',
      '/api/v1/bills',
      { ...CREATE_BODY, amount: 15000 },
      'AMOUNT_INVALID',
      'amount',
    ],
    [
      'stop-recurrence 沒帶 keepCurrent',
      'post',
      `/api/v1/bills/${ID}/stop-recurrence`,
      undefined,
      'VALIDATION_FAILED',
      'keepCurrent',
    ],
  ] as const)('%s 回 400', async (_label, method, path, body, code, field) => {
    const res = await request(app.getHttpServer())
      [method](path)
      .set('Authorization', auth)
      .send(body)
      .expect(400);
    expect(res.body).toMatchObject({
      code,
      details: [expect.objectContaining({ field, code })],
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
      const res = await request(app.getHttpServer())
        [method](path)
        .set('Authorization', auth)
        .expect(404);
      expect(res.body).toMatchObject({
        code: 'BILL_NOT_FOUND',
        message: '找不到這張帳單',
        details: [],
      });
    },
  );
});
