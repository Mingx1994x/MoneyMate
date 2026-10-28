import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { AppException } from '../../common/errors/app.exception.js';

/**
 * 註冊、登入的「每個 IP」次數限制（PRD FR-03：每個 IP 每分鐘 10 次，成功失敗都算）。
 * 只掛在這兩個端點（@UseGuards），不是全域；每個端點各自計數。上限來自 AUTH_IP_LIMIT_PER_MINUTE。
 * IP 是 req.ip：只有 TRUST_PROXY_HOPS 設對，在 Render 後面才會是真正的使用者 IP（configureApp）。
 * 超過時丟專案統一的 429 TOO_MANY_REQUESTS（帶 retryAfterSeconds），不用套件預設的訊息。
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    return Promise.reject(
      new AppException('TOO_MANY_REQUESTS', {
        retryAfterSeconds: detail.timeToExpire,
      }),
    );
  }
}
