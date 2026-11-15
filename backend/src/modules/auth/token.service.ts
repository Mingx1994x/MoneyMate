import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from './auth-user.js';

/** token 有效 24 小時，不做 refresh token（PRD 第七節） */
export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;

interface AccessTokenPayload {
  sub: string;
}

/**
 * 發放與驗證 access token。簽章演算法固定 HS256，金鑰是 JWT_SECRET（AuthModule 設定）。
 * 註冊、登入（AUTH-2）呼叫 signAccessToken；e2e 用 test/utils/test-token.ts 取得 token。
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(user: AuthUser): Promise<string> {
    const payload: AccessTokenPayload = { sub: user.id };
    return this.jwt.signAsync(payload);
  }

  /** 簽章錯誤、過期、格式不對都回 null，由呼叫的人決定要回什麼錯誤 */
  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    try {
      const payload = await this.jwt.verifyAsync<Partial<AccessTokenPayload>>(
        token,
        { algorithms: ['HS256'] },
      );
      return typeof payload.sub === 'string' && payload.sub !== ''
        ? { id: payload.sub }
        : null;
    } catch {
      return null;
    }
  }
}
