import { HttpException } from '@nestjs/common';
import {
  detail,
  ERROR_CODES,
  type ErrorCode,
  type ErrorCodeDef,
  type ErrorDetail,
} from './error-codes.js';

/** 代碼表允許的狀態碼：status，加上 alsoAllowed（若有） */
export type AllowedStatus<C extends ErrorCode> =
  | (typeof ERROR_CODES)[C]['status']
  | ((typeof ERROR_CODES)[C] extends {
      alsoAllowed: readonly (infer S extends number)[];
    }
      ? S
      : never);

/** 允許狀態碼 S 的代碼，例如 CodeAllowing<404> 只能是 *_NOT_FOUND 這類 */
export type CodeAllowing<S extends number> = {
  [C in ErrorCode]: S extends AllowedStatus<C> ? C : never;
}[ErrorCode];

export interface AppExceptionOptions<C extends ErrorCode> {
  status?: AllowedStatus<C>;
  details?: ErrorDetail[];
  /** 只有 429 會輸出（W2 的限流用） */
  retryAfterSeconds?: number;
}

/**
 * 業務錯誤一律丟這個：狀態碼與訊息從代碼表帶出，不在呼叫處寫。
 * - `throw new AppException('LOAN_NOT_FOUND')`
 * - `throw AppException.forField('ACCOUNT_NOT_FOUND', 'accountId', 400)`
 *
 * 屬性叫 opts：HttpException 已經有 private 的 options。
 */
export class AppException<
  C extends ErrorCode = ErrorCode,
> extends HttpException {
  constructor(
    readonly code: C,
    readonly opts: AppExceptionOptions<C> = {},
  ) {
    super({ code }, resolveStatus(code, opts.status));
  }

  /** 單一欄位的業務錯誤：頂層 code 與 details[0].code 一定相同 */
  static forField<C extends ErrorCode>(
    code: C,
    field: string,
    status?: AllowedStatus<C>,
  ): AppException<C> {
    return new AppException(code, { status, details: [detail(field, code)] });
  }
}

/** filter 用這個收窄；直接 instanceof 會得到 AppException<any>，oxlint 會報 no-unsafe-* */
export function isAppException(e: unknown): e is AppException {
  return e instanceof AppException;
}

// code 的型別是聯集或 ErrorCode 時（例如 ParseIdPipe 收到的參數），型別擋不住錯的狀態碼，
// 執行期再檢查一次：錯的組合會變成 500，測試時就會發現。
function resolveStatus(code: ErrorCode, status: number | undefined): number {
  const def: ErrorCodeDef = ERROR_CODES[code];
  const s = status ?? def.status;
  if (s !== def.status && !def.alsoAllowed?.includes(s)) {
    throw new Error('AppException: status not allowed for this code');
  }
  return s;
}
