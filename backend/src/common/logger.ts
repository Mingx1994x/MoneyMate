import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DestinationStream, LevelWithSilent } from 'pino';
import { stdTimeFunctions } from 'pino';
import type { Options } from 'pino-http';
import type { Params } from 'nestjs-pino';
import type { NextFunction, Request, Response } from 'express';
import { assignRequestId } from './request-id.js';

/**
 * 2026/10/29 對 nestjs-pino 5.3.1、pino 10.4.0、pino-http 11.0.0：
 * - wrapSerializers 預設 true 會先套標準 serializer，req 仍含 headers（含 Authorization）。
 *   設 false 後，下面的 serializer 拿到的是原始請求。
 * - 狀態碼 >= 500 時 pino-http 記 "request errored"，沒有 err 也會自己
 *   `new Error('failed with status code N')`（logger.js onResFinished）。
 *   serializeErr 只留 type，不留 message／stack。5xx 的細節仍由 filter 的 describeError 寫。
 * - quietReqLogger 的綁定鍵預設是 reqId；customAttributeKeys.reqId 改成 requestId。
 * - autoLogging.ignore 只拿掉完成日誌。genReqId 在判斷 ignore 之前就跑，req.id 與回應標頭都還在。
 * - AsyncLocalStorage 必須是 dist/esm 那一份。dist/cjs 是另一個物件，
 *   `import { Logger } from 'nestjs-pino'` 讀不到，請求中的日誌就沒有 requestId。
 *   Node 24 的 require() 與 import 共用 ESM 模組快取（2026/10/29 實測同一物件）。
 */
export interface LoggerParamsOptions {
  destination?: DestinationStream;
  level?: LevelWithSilent;
}

export interface SerializedRequestLog {
  id: unknown;
  method: string | undefined;
  url: string;
  ip: string | undefined;
}

export interface SerializedResponseLog {
  statusCode: number | undefined;
}

export interface SerializedErrorLog {
  type: string;
}

export function logLevelForEnv(
  env: string | undefined = process.env.NODE_ENV,
): LevelWithSilent {
  if (env === 'production') return 'info';
  if (env === 'test') return 'silent';
  return 'debug';
}

/** path 不含 query。沒有 path 時從 url 切掉 ? 之後，避免 query 裡的機密進日誌。 */
export function requestPath(req: { path?: string; url?: string }): string {
  if (typeof req.path === 'string') return req.path;
  const url = req.url ?? '';
  const queryAt = url.indexOf('?');
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

export function serializeReq(req: {
  id?: unknown;
  method?: string;
  path?: string;
  url?: string;
  ip?: string;
}): SerializedRequestLog {
  return {
    id: req.id,
    method: req.method,
    url: requestPath(req),
    ip: req.ip,
  };
}

export function serializeRes(res: {
  statusCode?: number;
}): SerializedResponseLog {
  return { statusCode: res.statusCode };
}

export function serializeErr(err: unknown): SerializedErrorLog {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = err.name;
    if (typeof name === 'string' && name !== '') return { type: name };
  }
  return { type: typeof err };
}

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
] as const;

export function createPinoLoggerParams(
  opts?: LoggerParamsOptions,
): Params<Request, Response> {
  const pinoHttp: Options<Request, Response> = {
    level: opts?.level ?? logLevelForEnv(),
    timestamp: stdTimeFunctions.isoTime,
    wrapSerializers: false,
    quietReqLogger: true,
    customAttributeKeys: { reqId: 'requestId' },
    genReqId: assignRequestId,
    autoLogging: {
      ignore: (req) => req.path === '/health',
    },
    customLogLevel: (_req, res, err) => {
      if (err != null || res.statusCode >= 500) return 'error';
      return 'info';
    },
    // 不加 customProps：quietReqLogger 的 child 已經用 requestId 當綁定鍵。
    // 再加一次的話，完成日誌的 JSON 會出現兩個 requestId（2026/10/29 實測）。
    serializers: {
      req: serializeReq,
      res: serializeRes,
      err: serializeErr,
    },
    redact: { paths: [...REDACT_PATHS], remove: true },
  };

  if (opts?.destination) {
    return { pinoHttp: [pinoHttp, opts.destination] };
  }
  return { pinoHttp };
}

interface PinoHttpMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
}

interface RequestWithLogs {
  log?: object;
  allLogs?: object[];
}

interface PinoStorage {
  run: (store: object, next: () => void) => void;
}

interface PinoStore {
  new (logger: object | undefined, responseLogger?: object): object;
}

/**
 * nestjs-pino 的 middleware 預設只掛在 /api/v1（與排除前綴的 /health）。
 * /api/docs 與前綴外的 404 不會進。套件沒有公開這兩個內部模組，
 * 用實際檔案路徑載入 ESM 建置，避開 package exports，並與 Logger 共用同一個 storage。
 * 掛在 Express 上，每個路徑只跑一次；AppModule 的 forRoutes 指到不會打到的路徑，避免再掛一次。
 * ensureLoggerMiddleware 是程序裡的單例，誰先呼叫誰決定選項；AppModule 與這裡傳的是同一份。
 */
export function usePinoHttp(app: {
  use: (handler: PinoHttpMiddleware) => void;
}): void {
  const { ensureLoggerMiddleware, storage, Store } = loadNestjsPinoEsm();
  const middleware = ensureLoggerMiddleware(
    readHttpOptions(createPinoLoggerParams()),
  );
  app.use((req, res, next) => {
    middleware(req, res, () => {
      const withLogs = req as unknown as RequestWithLogs;
      const log = withLogs.allLogs?.at(-1) ?? withLogs.log;
      storage.run(new Store(log), () => next());
    });
  });
}

function loadNestjsPinoEsm(): {
  ensureLoggerMiddleware: (
    params: Options<Request, Response>,
  ) => PinoHttpMiddleware;
  storage: PinoStorage;
  Store: PinoStore;
} {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('nestjs-pino/package.json');
  const dist = join(dirname(packageJson), 'dist/esm');
  const rootLogger = require(join(dist, 'rootLogger.js')) as {
    ensureLoggerMiddleware: (
      params: Options<Request, Response>,
    ) => PinoHttpMiddleware;
  };
  const storageMod = require(join(dist, 'storage.js')) as {
    storage: PinoStorage;
    Store: PinoStore;
  };
  return {
    ensureLoggerMiddleware: rootLogger.ensureLoggerMiddleware,
    storage: storageMod.storage,
    Store: storageMod.Store,
  };
}

export function readHttpOptions(
  params: Params<Request, Response>,
): Options<Request, Response> {
  const http = params.pinoHttp;
  if (http === undefined) {
    throw new Error('createPinoLoggerParams: missing pinoHttp');
  }
  if (Array.isArray(http)) return http[0];
  if ('write' in http) {
    throw new Error('createPinoLoggerParams: pinoHttp is a stream');
  }
  return http;
}
