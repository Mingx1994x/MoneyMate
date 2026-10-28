import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';

/**
 * categories 空殼：全部端點回 501。
 * AUTH-1 加上 guard 後，沒帶 token 會先回 401，這裡要改成帶 token（C 的 test/utils/auth.ts）。
 * 全域 ValidationPipe 在 INF-4 才加入，之前不測 query 驗證（DTO 驗證見 category-dtos.spec.ts）。
 */
describe('分類空殼（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(['/api/v1/categories', '/api/v1/categories?type=income'])(
    'get %s 回 501 NOT_IMPLEMENTED',
    async (path) => {
      const res = await request(app.getHttpServer()).get(path).expect(501);
      expect(res.body).toMatchObject({
        statusCode: 501,
        code: 'NOT_IMPLEMENTED',
        details: [],
      });
    },
  );
});
