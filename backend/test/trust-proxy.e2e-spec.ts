import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { IpTestController } from './utils/ip-test.controller.js';

// TRUST_PROXY_HOPS=1 獨立一個檔案：@nestjs/config 在 import AppModule 時就驗證並存下環境變數，
// 同一個檔案換不了值。stubEnv 之後才動態 import createTestApp（照 src/swagger-disabled.spec.ts）。
// TRUST_PROXY_HOPS=0（.env.test 的預設）的案例在 app.e2e-spec.ts。
describe('TRUST_PROXY_HOPS=1（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const { createTestApp } = await import('./utils/create-test-app.js');
    app = await createTestApp({ controllers: [IpTestController] });
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('信任一層代理：req.ip 是 X-Forwarded-For 的最後一個位址', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/__ip-test')
      .set('X-Forwarded-For', '1.2.3.4')
      .expect(200);
    expect(res.body).toEqual({ ip: '1.2.3.4' });
  });

  it('偽造的前段位址不會被採用', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/__ip-test')
      .set('X-Forwarded-For', '6.6.6.6, 1.2.3.4')
      .expect(200);
    expect(res.body).toEqual({ ip: '1.2.3.4' });
  });
});
