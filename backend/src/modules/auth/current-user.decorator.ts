import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from './auth-user.js';

/**
 * 取得登入者（PRD 16.7 的 getCurrentUser）：`findAll(@CurrentUser() user: AuthUser)`，
 * 再用 `user.id` 查詢。只能用在需要登入的端點；@Public() 的端點拿不到。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    // guard 沒跑（例如端點加了 @Public()）卻用了這個裝飾器，是程式寫錯，回 500
    if (!user) throw new Error('@CurrentUser() 只能用在需要登入的端點');
    return user;
  },
);
