import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { bearer } from './utils/test-token.js';

/**
 * categories 空殼：全部端點回 501。
 * AUTH-1 之後要帶 token，否則 guard 先回 401（沒帶 token 的情況在 auth.e2e-spec.ts）。
 * query 驗證由全域 ValidationPipe 負責，這裡不另外測（DTO 驗證見 category-dtos.spec.ts）。
 */
describe('分類空殼（e2e）', () => {
  let app: INestApplication<App>;
  let auth: string;

  beforeAll(async () => {
    app = await createTestApp();
    auth = await bearer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(['/api/v1/categories', '/api/v1/categories?type=income'])(
    'get %s 回 501 NOT_IMPLEMENTED',
    async (path) => {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', auth)
        .expect(501);
      expect(res.body).toMatchObject({
        statusCode: 501,
        code: 'NOT_IMPLEMENTED',
        details: [],
      });
    },
  );
});
