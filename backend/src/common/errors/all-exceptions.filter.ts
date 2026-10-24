import { randomUUID } from 'node:crypto';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isAppException } from './app.exception.js';
import { detail, ERROR_CODES, type ErrorCode } from './error-codes.js';
import type { ErrorResponseDto } from './error-response.dto.js';

/** 沒有指定代碼的 HttpException 與 http-errors 類錯誤，依狀態碼套用的代碼 */
const FALLBACK_CODES: Readonly<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'AUTH_UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'TOO_MANY_REQUESTS',
  501: 'NOT_IMPLEMENTED',
};

/**
 * 所有例外都經過這裡，回應 PRD 13 的格式（configureApp 註冊，正式程式與 e2e 共用）。
 * - /health 的 503 由 controller 直接回傳，不經這裡。
 * - /api/v1 以外的未知路徑由 Express 回 HTML 404，也不經這裡（Nest 的 not-found handler 只掛在前綴底下）。
 * - 4xx 不記日誌：body-parser 的錯誤外部可以任意觸發，記 stack 會被拿來灌日誌。
 * - 5xx（501 除外）一律用 describeError 記 error。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const requestId = getRequestId(ctx.getRequest<Request>());

    // 回應已經開始送出（例如 @Res() 寫了一半才丟錯）：改不了狀態碼，記下來並結束連線，
    // 否則連線會一直掛到逾時
    if (res.headersSent) {
      this.logError(requestId, '回應送出後才發生例外', exception);
      res.end();
      return;
    }

    const body = this.toBody(exception, requestId);
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, requestId: string): ErrorResponseDto {
    if (isAppException(exception)) {
      const statusCode = exception.getStatus();
      if (statusCode >= 500 && statusCode !== 501) {
        this.logError(requestId, `${exception.code}`, exception);
      }
      // details 的訊息一律重新取自代碼表，呼叫端手寫的 message 不會送出去
      const details = (exception.opts.details ?? []).map((d) =>
        detail(d.field, d.code),
      );
      const body = build(exception.code, statusCode, requestId, details);
      const retryAfter = exception.opts.retryAfterSeconds;
      if (statusCode === 429 && retryAfter !== undefined) {
        // DTO 宣告為 integer、minimum 1
        body.retryAfterSeconds = Math.max(1, Math.ceil(retryAfter));
      }
      return body;
    }

    // Nest 的 ExpressAdapter 會先把 JSON 解析錯誤轉成 BadRequestException，所以也走這裡
    if (exception instanceof HttpException) {
      return this.fromStatus(exception.getStatus(), exception, requestId);
    }

    // body-parser 的其他錯誤（415、413、壞掉的 gzip…）：http-errors 的慣例是 status＋expose
    const status = httpErrorStatus(exception);
    if (status !== undefined) {
      return this.fromStatus(status, exception, requestId);
    }

    this.logError(requestId, '未預期的例外', exception);
    return build('INTERNAL_ERROR', 500, requestId);
  }

  private fromStatus(
    status: number,
    exception: unknown,
    requestId: string,
  ): ErrorResponseDto {
    const code = FALLBACK_CODES[status];
    if (code !== undefined) return build(code, status, requestId);

    if (status >= 500) {
      // 例如 InternalServerErrorException、ServiceUnavailableException：要留 stack 與 cause 才查得到原因
      this.logError(requestId, `HTTP ${status}`, exception);
    } else {
      // 照理不會發生：代表有人丟了備援表以外的 4xx
      this.logger.warn(
        `[${requestId}] 沒有對應代碼的狀態碼 ${status}（${errorName(exception)}），改回 500`,
      );
    }
    return build('INTERNAL_ERROR', 500, requestId);
  }

  private logError(requestId: string, label: string, exception: unknown): void {
    this.logger.error(`[${requestId}] ${label} ${describeError(exception)}`);
  }
}

function build(
  code: ErrorCode,
  statusCode: number,
  requestId: string,
  details: ErrorResponseDto['details'] = [],
): ErrorResponseDto {
  return {
    statusCode,
    code,
    message: ERROR_CODES[code].message,
    details,
    requestId,
  };
}

// INF-5（nestjs-pino）之後 req.id 是驗證過的 request ID；在那之前每個錯誤各自產生一個
function getRequestId(req: Request): string {
  const id = (req as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : randomUUID();
}

function httpErrorStatus(exception: unknown): number | undefined {
  const status = prop(exception, 'status') ?? prop(exception, 'statusCode');
  return typeof status === 'number' &&
    status >= 400 &&
    status <= 499 &&
    prop(exception, 'expose') === true
    ? status
    : undefined;
}

function prop(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function errorName(exception: unknown): string {
  const name = prop(exception, 'name');
  return typeof name === 'string' ? name : typeof exception;
}

/**
 * 500 的日誌內容。Prisma 的錯誤不記 message、stack、整包 meta：stack 第一行就是 message，
 * 可能含查詢參數；CHECK 違反的 cause.detail 含整列資料。只記名稱、代碼與約束名稱。
 */
export function describeError(exception: unknown): string {
  const name = errorName(exception);

  if (name.startsWith('PrismaClient')) {
    const meta = prop(exception, 'meta');
    const cause = prop(prop(meta, 'driverAdapterError'), 'cause');
    return JSON.stringify({
      name,
      code: prop(exception, 'code'),
      modelName: prop(meta, 'modelName'),
      kind: prop(cause, 'kind'),
      constraint: constraintName(cause),
    });
  }

  // DriverAdapterError 只有 cause，沒有 code、meta
  if (name === 'DriverAdapterError') {
    const cause = prop(exception, 'cause');
    return JSON.stringify({
      name,
      kind: prop(cause, 'kind'),
      constraint: constraintName(cause),
    });
  }

  // new Prisma.Decimal(s) 失敗時 message 會帶出輸入值（請求的金額一律用 toMoney，這裡是保險）
  const message = prop(exception, 'message');
  if (typeof message === 'string' && message.startsWith('[DecimalError]')) {
    return name;
  }

  const stack = prop(exception, 'stack');
  return typeof stack === 'string' ? stack : name;
}

// unique 與 FK：adapter 會給 cause.constraint（物件，內容是索引名稱或欄位名稱，不含值）。
// CHECK（P2039）：cause 沒有 constraint，只能從 message 取出名稱，message 本身不記。
function constraintName(cause: unknown): unknown {
  const constraint = prop(cause, 'constraint');
  if (constraint !== undefined) return constraint;
  const message = prop(cause, 'message');
  if (typeof message !== 'string') return undefined;
  return /violates check constraint "([^"]+)"/.exec(message)?.[1];
}
