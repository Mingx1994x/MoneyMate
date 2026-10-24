import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { OPENAPI_EXPORT_ENV } from './openapi/export-env.constants.js';

// 第二種環境，獨立一個檔案（動態 import 會被快取，同一個檔案換不了環境）
describe('SWAGGER_ENABLED=false', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(OPENAPI_EXPORT_ENV)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv('SWAGGER_ENABLED', 'false');
    const { AppModule } = await import('./app.module.js');
    const { configureApp } = await import('./app.setup.js');
    const { setupSwagger } = await import('./swagger.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(nestApp);
    app = nestApp;
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('不掛載 Swagger UI 與 JSON（前綴外的路徑回 Express 的 HTML 404，只看狀態碼）', async () => {
    await request(app.getHttpServer()).get('/api/docs').expect(404);
    await request(app.getHttpServer()).get('/api/docs-json').expect(404);
  });
});
