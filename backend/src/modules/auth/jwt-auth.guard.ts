import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/errors/app.exception.js';
import type { AuthenticatedRequest } from './auth-user.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { TokenService } from './token.service.js';

/**
 * 全域 guard（AuthModule 用 APP_GUARD 註冊）：除了 @Public() 的端點，
 * 都要帶 `Authorization: Bearer <token>`，否則回 401 AUTH_UNAUTHENTICATED。
 * 沒帶、格式不對、簽章錯誤、過期都回同一個代碼，不透露是哪一種。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    const user = token ? await this.tokens.verifyAccessToken(token) : null;
    if (!user) throw new AppException('AUTH_UNAUTHENTICATED');

    request.user = user;
    return true;
  }
}

/** `Bearer <token>`，Bearer 不分大小寫（RFC 6750） */
export function extractBearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer +(\S+)$/i);
  return match ? match[1] : null;
}
