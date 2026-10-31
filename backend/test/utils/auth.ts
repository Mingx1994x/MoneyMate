import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/**
 * 真的走註冊、登入 API 的測試工具（C 的整合測試基礎設施，PRD 20.4）。
 * - 只要「有登入」就好、不在乎怎麼登入的測試，用 D 的 test-token.ts（bearer(app, userId)），比較快。
 * - 要測「註冊 → 登入 → 用 token 操作」這種完整流程時，用這裡的 registerUser、loginUser。
 * 註冊、登入有次數限制：.env.test 要有 AUTH_IP_LIMIT_PER_MINUTE=1000（見 .env.test.example）。
 */

/** 測試用的密碼：8–72 字元（PRD 13 的 DTO 規則） */
export const TEST_PASSWORD = 'test-password-1234';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** 整個 Authorization 標頭的值：`.set('Authorization', user.auth)` */
  auth: string;
}

let sequence = 0;

/** 每次呼叫都不一樣的 Email，避免同一個檔案裡重複註冊 */
export function uniqueEmail(prefix = 'user'): string {
  sequence += 1;
  return `${prefix}-${process.pid}-${sequence}@example.com`;
}

/**
 * 呼叫 POST /api/v1/auth/register 建一個使用者，回傳 id、Email、密碼與 Authorization 標頭。
 * 不是 201 時直接丟錯，訊息帶狀態碼與回應，方便看出是哪裡壞了。
 */
export async function registerUser(
  app: INestApplication<App>,
  opts: { email?: string; password?: string; displayName?: string } = {},
): Promise<TestUser> {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? TEST_PASSWORD;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password, displayName: opts.displayName });
  if (res.status !== 201) {
    throw new Error(
      `registerUser 失敗：${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const body = res.body as { accessToken: string; user: { id: string } };
  return {
    id: body.user.id,
    email,
    password,
    auth: `Bearer ${body.accessToken}`,
  };
}

/**
 * 呼叫 POST /api/v1/auth/login，回傳新的 Authorization 標頭。
 * 用來測「重新登入後資料仍在」（PRD 最小流程 ⑤）。
 */
export async function loginUser(
  app: INestApplication<App>,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(
      `loginUser 失敗：${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return `Bearer ${(res.body as { accessToken: string }).accessToken}`;
}
