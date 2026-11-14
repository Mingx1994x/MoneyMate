import { gzipSync } from 'node:zlib';
import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Logger,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { Public } from '../src/modules/auth/index.js';
import { createTestApp } from './utils/create-test-app.js';

// 只給這個測試用：測的是錯誤格式，不是登入，所以設成公開
@Public()
@Controller('__errors-test')
class ErrorsTestController {
  @Get('not-implemented')
  notImplemented(): void {
    throw new NotImplementedException();
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('錯誤格式（e2e）', () => {
  let app: INestApplication<App>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ErrorsTestController] });
  });

  beforeEach(() => {
    errorSpy = vi.spyOn(Logger.prototype, 'error');
    warnSpy = vi.spyOn(Logger.prototype, 'warn');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('/api/v1 底下的未知路由回 404 NOT_FOUND，格式符合 PRD 13', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);
    const { requestId, ...rest } = res.body as Record<string, unknown>;
    expect(rest).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: '找不到要求的資源',
      details: [],
    });
    expect(requestId).toMatch(UUID);
  });

  it('/api/v1 以外的未知路徑回 Express 的 HTML 404（已知的例外，鎖住目前的行為）', async () => {
    const res = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('NotImplementedException 回 501 NOT_IMPLEMENTED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/__errors-test/not-implemented')
      .expect(501);
    expect(res.body).toMatchObject({
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
      details: [],
    });
  });

  describe('body-parser 的錯誤（4xx 都不記日誌）', () => {
    const post = () =>
      request(app.getHttpServer()).post('/api/v1/__errors-test/echo');

    afterEach(() => {
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('JSON 格式錯誤回 400 BAD_REQUEST', async () => {
      const res = await post()
        .set('Content-Type', 'application/json')
        .send('{"a":')
        .expect(400);
      expect(res.body).toMatchObject({ code: 'BAD_REQUEST', details: [] });
    });

    it('body 超過 100kb 回 413 PAYLOAD_TOO_LARGE', async () => {
      const res = await post()
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ a: 'x'.repeat(110 * 1024) }))
        .expect(413);
      expect(res.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    });

    it('charset 不是 UTF-8 回 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      const res = await post()
        .set('Content-Type', 'application/json; charset=latin1')
        .send('{"a":1}')
        .expect(415);
      expect(res.body).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    });

    it('不支援的 Content-Encoding 回 415', async () => {
      await post()
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'foo')
        .send('{"a":1}')
        .expect(415);
    });

    it('壞掉的 gzip 回 400', async () => {
      const broken = gzipSync('{"a":1}').subarray(0, 8);
      await post()
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send(broken)
        .expect(400);
    });
  });

  it('/health 不受影響', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', db: 'ok' });
  });
});
