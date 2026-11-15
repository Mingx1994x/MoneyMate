import { AppException } from './app.exception.js';
import { DB_CONSTRAINT_CODES } from './db-constraint-codes.js';
import type { ErrorCode } from './error-codes.js';

export interface PrismaRequestError {
  code: string;
  /** `cause.constraint.index`；沒有字串名稱時省略 */
  index?: string;
}

interface ConstraintCode {
  code: ErrorCode;
  field?: string;
}

/** 用字串索引查表；不在表裡的名稱是 undefined */
const CONSTRAINTS: Readonly<Record<string, ConstraintCode>> =
  DB_CONSTRAINT_CODES;

/**
 * 只認 PrismaClientKnownRequestError。
 * 名稱只取 constraint.index。沒有 index 時不拿 fields 來對（可能對錯約束）。
 */
export function readPrismaRequestError(
  error: unknown,
): PrismaRequestError | undefined {
  if (prop(error, 'name') !== 'PrismaClientKnownRequestError') return undefined;
  const code = prop(error, 'code');
  if (typeof code !== 'string') return undefined;
  const cause = prop(prop(prop(error, 'meta'), 'driverAdapterError'), 'cause');
  const index = prop(prop(cause, 'constraint'), 'index');
  return typeof index === 'string' ? { code, index } : { code };
}

/**
 * 對得上的資料庫錯誤轉成 AppException；對不上回 undefined，由 filter 維持 500。
 * 不讀 message：裡面可能有查詢參數或整列資料。
 */
export function databaseException(error: unknown): AppException | undefined {
  const info = readPrismaRequestError(error);
  if (!info) return undefined;
  if (info.code === 'P2025') return new AppException('NOT_FOUND');
  if (info.code === 'P2020') return new AppException('AMOUNT_OVERFLOW');
  if (info.code !== 'P2002' && info.code !== 'P2003') return undefined;
  if (info.index === undefined) return undefined;

  const mapped = CONSTRAINTS[info.index];
  if (!mapped) return undefined;
  if (mapped.field !== undefined) {
    return AppException.forField(mapped.code, mapped.field);
  }
  return new AppException(mapped.code);
}

function prop(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
