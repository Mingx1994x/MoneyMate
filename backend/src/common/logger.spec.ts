import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import type { Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import {
  createPinoLoggerParams,
  logLevelForEnv,
  readHttpOptions,
  serializeErr,
  serializeReq,
  serializeRes,
  usePinoHttp,
} from './logger.js';

describe('serializeReq', () => {
  it('只留 id、method、url、ip，query 與 headers 不出現', () => {
    const out = serializeReq({
      id: 'client-id-1',
      method: 'GET',
      url: '/api/v1/x?password=SENTINEL',
      path: '/api/v1/x',
      ip: '127.0.0.1',
    });
    expect(Object.keys(out).sort()).toEqual(['id', 'ip', 'method', 'url']);
    expect(out).toEqual({
      id: 'client-id-1',
      method: 'GET',
      url: '/api/v1/x',
      ip: '127.0.0.1',
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain('SENTINEL');
    expect(text).not.toContain('authorization');
    expect(text).not.toContain('password');
  });

  it('沒有 path 時從 url 切掉 query', () => {
    expect(
      serializeReq({ url: '/api/v1/x?password=SENTINEL', method: 'POST' }).url,
    ).toBe('/api/v1/x');
  });
});

describe('serializeRes', () => {
  it('只有 statusCode，不含 Set-Cookie', () => {
    const out = serializeRes({
      statusCode: 200,
      header: 'HTTP/1.1 200 OK\r\nSet-Cookie: SENTINEL\r\n\r\n',
    } as { statusCode: number });
    expect(out).toEqual({ statusCode: 200 });
    expect(Object.keys(out)).toEqual(['statusCode']);
    expect(JSON.stringify(out)).not.toContain('SENTINEL');
  });
});

describe('serializeErr', () => {
  it('不留 message 與 stack', () => {
    const out = serializeErr(new Error('SELECT … SENTINEL'));
    expect(out).toEqual({ type: 'Error' });
    const text = JSON.stringify(out);
    expect(text).not.toContain('SENTINEL');
    expect(text).not.toContain('SELECT');
  });
});

describe('nestjs-pino ESM', () => {
  it('Vitest 可以 import Logger 與 LoggerModule', async () => {
    const mod = await import('nestjs-pino');
    expect(mod.Logger).toBeTypeOf('function');
    expect('forRoot' in mod.LoggerModule).toBe(true);
  }, 20_000);
});

describe('usePinoHttp', () => {
  it('請求中的 PinoLogger 帶同一個 requestId', async () => {
    const holders: Array<
      (req: Request, res: Response, next: () => void) => void
    > = [];
    usePinoHttp({
      use(handler) {
        holders.push(handler);
      },
    });
    const req = Object.assign(new EventEmitter(), {
      method: 'GET',
      url: '/api/v1/x',
      path: '/api/v1/x',
      headers: { 'x-request-id': 'client-id-1' },
      socket: { remoteAddress: '127.0.0.1' },
    });
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
    });
    let seen: unknown;
    const { PinoLogger } = await import('nestjs-pino');
    const handler = holders[0];
    if (handler === undefined) {
      throw new Error('usePinoHttp 沒有掛上 middleware');
    }
    handler(req as unknown as Request, res as unknown as Response, () => {
      const logger = new PinoLogger({ pinoHttp: { level: 'silent' } });
      seen = logger.logger.bindings().requestId;
    });
    expect(seen).toBe('client-id-1');
  }, 20_000);
});

describe('createPinoLoggerParams', () => {
  it('開關符合規格', () => {
    const http = readHttpOptions(createPinoLoggerParams({ level: 'info' }));
    expect(http.wrapSerializers).toBe(false);
    expect(http.quietReqLogger).toBe(true);
    expect(http.customAttributeKeys).toEqual({ reqId: 'requestId' });
    expect(http.redact).toMatchObject({
      paths: expect.arrayContaining(['req.headers.authorization']) as string[],
      remove: true,
    });
    expect(http.useLevel).toBeUndefined();
  });

  it('NODE_ENV=test 時預設 level 是 silent', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(logLevelForEnv()).toBe('silent');
    expect(readHttpOptions(createPinoLoggerParams()).level).toBe('silent');
    vi.unstubAllEnvs();
  });

  it('production 是 info、其他是 debug', () => {
    expect(logLevelForEnv('production')).toBe('info');
    expect(logLevelForEnv('development')).toBe('debug');
    vi.stubEnv('NODE_ENV', '');
    expect(logLevelForEnv()).toBe('debug');
    vi.unstubAllEnvs();
  });
});

describe('pino-http', () => {
  function run(path: string, statusCode = 200, err?: Error): string {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: unknown, _encoding, callback) {
        if (typeof chunk === 'string') lines.push(chunk);
        else if (Buffer.isBuffer(chunk)) lines.push(chunk.toString());
        callback();
      },
    });
    const http = readHttpOptions(
      createPinoLoggerParams({ destination, level: 'info' }),
    );
    const middleware = pinoHttp(http, destination);
    const req = Object.assign(new EventEmitter(), {
      method: 'POST',
      url: `${path}?password=SENTINEL-PASS`,
      path,
      headers: { authorization: 'Bearer SENTINEL-TOKEN' },
      ip: '203.0.113.9',
      body: { password: 'SENTINEL-PASS' },
      socket: { remoteAddress: '10.0.0.1', remotePort: 9 },
    });
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      err?: Error;
      setHeader: ReturnType<typeof vi.fn>;
      getHeader: ReturnType<typeof vi.fn>;
      end: () => void;
    };
    res.statusCode = statusCode;
    res.err = err;
    res.setHeader = vi.fn();
    res.getHeader = vi.fn();
    res.end = () => {
      // pino-http 用 writableEnded 區分 completed 與 aborted
      Object.assign(res, { writableEnded: true });
      res.emit('finish');
    };
    middleware(
      req as unknown as Request,
      res as unknown as Response,
      () => undefined,
    );
    res.end();
    return lines.join('');
  }

  it('一般請求的完成日誌有 requestId，沒有 token 與密碼', () => {
    const text = run('/api/v1/x');
    expect(text).toContain('request completed');
    expect(text.match(/"requestId"/g)).toHaveLength(1);
    expect(text).not.toContain('SENTINEL-TOKEN');
    expect(text).not.toContain('SENTINEL-PASS');
    expect(text).not.toContain('authorization');
    const line = JSON.parse(text.trim()) as {
      requestId: string;
      req: { url: string; ip: string };
    };
    expect(line.requestId).toMatch(/^[A-Za-z0-9-]{1,64}$/);
    expect(line.req.url).toBe('/api/v1/x');
    expect(line.req.ip).toBe('203.0.113.9');
  });

  it('/health 不寫 request completed，但仍產生 request id', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: unknown, _encoding, callback) {
        if (typeof chunk === 'string') lines.push(chunk);
        else if (Buffer.isBuffer(chunk)) lines.push(chunk.toString());
        callback();
      },
    });
    const http = readHttpOptions(
      createPinoLoggerParams({ destination, level: 'info' }),
    );
    const middleware = pinoHttp(http, destination);
    const req = Object.assign(new EventEmitter(), {
      method: 'GET',
      url: '/health',
      path: '/health',
      headers: {},
      socket: {},
    });
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      setHeader: ReturnType<typeof vi.fn>;
      getHeader: ReturnType<typeof vi.fn>;
      end: () => void;
    };
    res.statusCode = 200;
    res.setHeader = vi.fn();
    res.getHeader = vi.fn();
    res.end = () => {
      Object.assign(res, { writableEnded: true });
      res.emit('finish');
    };
    middleware(
      req as unknown as Request,
      res as unknown as Response,
      () => undefined,
    );
    res.end();
    expect(lines).toEqual([]);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      expect.stringMatching(/^[A-Za-z0-9-]{1,64}$/),
    );
  });

  it('/api/v1/health 仍寫 request completed', () => {
    expect(run('/api/v1/health', 404)).toContain('request completed');
  });

  it('500 走 request errored，err 不含訊息', () => {
    const text = run('/api/v1/x', 500, new Error('SELECT … SENTINEL'));
    expect(text).toContain('request errored');
    expect(text).not.toContain('SENTINEL');
    expect(text).not.toContain('SELECT');
    const line = JSON.parse(text.trim()) as {
      err?: { type?: string; message?: string };
    };
    expect(line.err).toEqual({ type: 'Error' });
  });
});
