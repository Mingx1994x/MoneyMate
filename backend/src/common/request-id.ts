import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

/** INF-1：只接受這個格式，不符就重新產生，避免把換行或路徑寫進日誌與回應標頭 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function resolveRequestId(
  header: string | string[] | undefined,
): string {
  if (typeof header === 'string' && REQUEST_ID_PATTERN.test(header)) {
    return header;
  }
  return randomUUID();
}

/** 合法的進來也寫回標頭，客戶端才對得到自己送的 ID */
export function assignRequestId(req: Request, res: Response): string {
  const id = resolveRequestId(req.headers['x-request-id']);
  res.setHeader('X-Request-Id', id);
  return id;
}
