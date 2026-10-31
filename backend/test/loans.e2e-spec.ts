import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { bearer } from './utils/test-token.js';

const ID = '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10';

// 全域 ValidationPipe（INF-4）之後，不合法的 body／query 會先回 400，要送合法的值才會走到 501
const CREATE_BODY = {
  name: '房貸',
  loanType: 'mortgage',
  outstandingBalance: '1000000.00',
  paymentDay: 5,
  endDate: '2031-09-30',
};
const PREVIEW =
  '/api/v1/loans/payment-preview?outstandingBalance=1000000.00&interestRate=3&endDate=2031-09-30';

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
    ['get', PREVIEW, undefined],
    ['get', '/api/v1/loans', undefined],
    ['post', '/api/v1/loans', CREATE_BODY],
    ['get', `/api/v1/loans/${ID}`, undefined],
    ['patch', `/api/v1/loans/${ID}`, { name: '房貸' }],
    ['delete', `/api/v1/loans/${ID}`, undefined],
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

  it('payment-preview 宣告在 :id 之前：回 501，不是被 :id 接走的 404', async () => {
    await request(app.getHttpServer())
      .get(PREVIEW)
      .set('Authorization', auth)
      .expect(501);
  });

  it.each([
    [
      'POST 的金額送 JSON 數字',
      'post',
      '/api/v1/loans',
      { ...CREATE_BODY, outstandingBalance: 1000000 },
      'AMOUNT_INVALID',
      'outstandingBalance',
    ],
    [
      'PATCH 不可為空的欄位傳 null',
      'patch',
      `/api/v1/loans/${ID}`,
      { outstandingBalance: null },
      'AMOUNT_INVALID',
      'outstandingBalance',
    ],
    [
      'payment-preview 帶未宣告的參數',
      'get',
      `${PREVIEW}&foo=1`,
      undefined,
      'VALIDATION_FAILED',
      'foo',
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
