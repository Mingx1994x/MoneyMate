import type { Request } from 'express';

/**
 * 登入者。目前只有 id：token 只帶 sub，guard 不查資料庫。
 * 業務查詢一律帶 userId（`where: { id, userId }`），需要 email 等資料時由 service 自己查。
 */
export interface AuthUser {
  id: string;
}

/** JwtAuthGuard 驗證通過後，把登入者放在 request.user */
export type AuthenticatedRequest = Request & { user?: AuthUser };
