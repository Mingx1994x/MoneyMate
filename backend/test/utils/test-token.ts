import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { TokenService } from '../../src/modules/auth/index.js';

/** 預設的測試使用者 id：只用來簽 token，資料庫裡不一定有這個使用者 */
export const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * 直接簽一個 token，回傳整個 Authorization 標頭的值：
 * `request(server).get(path).set('Authorization', await bearer(app))`。
 * 只測「有登入」的空殼端點時用這個；要測真的註冊、登入，用 C 的 test/utils/auth.ts（W2）。
 * 要查資料庫的測試，userId 要傳資料庫裡真的有的使用者。
 */
export async function bearer(
  app: INestApplication<App>,
  userId: string = TEST_USER_ID,
): Promise<string> {
  const token = await app.get(TokenService).signAccessToken({ id: userId });
  return `Bearer ${token}`;
}
