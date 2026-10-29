import { request as httpRequest, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { REQUEST_ID_PATTERN } from '../src/common/request-id.js';
import { createTestApp } from './utils/create-test-app.js';

function requestIdOf(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('requestId' in body)) {
    return undefined;
  }
  return body.requestId;
}

describe('request ID 與 Cache-Control（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('未知路由的 requestId 與 X-Request-Id 相同，且有 no-store', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);
    const requestId = requestIdOf(res.body);
    expect(requestId).toEqual(expect.stringMatching(REQUEST_ID_PATTERN));
    expect(res.headers['x-request-id']).toBe(requestId);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('合法的 X-Request-Id 原樣回到標頭與 body', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('X-Request-Id', 'client-id-1')
      .expect(404);
    expect(requestIdOf(res.body)).toBe('client-id-1');
    expect(res.headers['x-request-id']).toBe('client-id-1');
  });

  it.each(['', 'has space', 'a'.repeat(65), 'a/b'])(
    '不合法標頭 %j 會重產，標頭與 body 仍相同',
    async (header) => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .set('X-Request-Id', header)
        .expect(404);
      const requestId = requestIdOf(res.body);
      expect(requestId).toEqual(expect.stringMatching(REQUEST_ID_PATTERN));
      expect(requestId).not.toBe(header);
      expect(res.headers['x-request-id']).toBe(requestId);
    },
  );

  it('重複的 X-Request-Id 不採用', async () => {
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
    }
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('測試用的 HTTP server 沒有 port');
    }

    const res = await new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: { requestId?: string };
    }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/v1/does-not-exist',
          headers: { 'X-Request-Id': ['has space', 'also-bad'] },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          incoming.on('end', () => {
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: JSON.parse(Buffer.concat(chunks).toString()) as {
                requestId?: string;
              },
            });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(res.status).toBe(404);
    expect(res.body.requestId).toEqual(
      expect.stringMatching(REQUEST_ID_PATTERN),
    );
    expect(res.body.requestId).not.toBe('has space');
    expect(res.body.requestId).not.toBe('also-bad');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('/api/docs 與前綴外的 404 也有 X-Request-Id', async () => {
    const docs = await request(app.getHttpServer()).get('/api/docs');
    expect(docs.headers['x-request-id']).toEqual(
      expect.stringMatching(REQUEST_ID_PATTERN),
    );
    expect(docs.headers['cache-control']).toBe('no-store');

    const missing = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);
    expect(missing.headers['x-request-id']).toEqual(
      expect.stringMatching(REQUEST_ID_PATTERN),
    );
    expect(missing.headers['cache-control']).toBe('no-store');
  });

  it('/health 有 X-Request-Id 與 no-store', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.headers['x-request-id']).toEqual(
      expect.stringMatching(REQUEST_ID_PATTERN),
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
