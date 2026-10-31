import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClockService } from '../../clock/clock.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { EnvVars } from '../../config/env.validation.js';

/** 最多同時記幾個 Email：攻擊者可以任意換 Email，不設上限記憶體會被灌爆 */
const MAX_TRACKED_EMAILS = 10_000;

interface Entry {
  count: number;
  /** 視窗結束的時間（毫秒）：從第一次失敗開始算 */
  windowEndsAt: number;
}

/**
 * 登入的「每個 Email」失敗次數限制（PRD FR-03）：同一個 Email 在視窗內（預設 15 分鐘）
 * 失敗達上限（預設 5 次）後，到視窗結束前一律回 429，即使密碼正確也一樣。
 *
 * - 固定視窗：從第一次失敗開始算，到期後整筆清掉；登入成功會歸零。
 * - 不存在的 Email 也要記（AuthService 一律呼叫 recordFailure），否則從 429 就能看出 Email 有沒有註冊。
 * - 計數存在記憶體，只在單一後端實例有效（PRD 第十九節、第二十九節第 14 項）；
 *   重新啟動會歸零。之後要多實例，改成共享儲存（例如 Redis）。
 * - 時間一律用 ClockService.now()（測試用 FakeClock 控制）。
 * 「每個 IP」那條由 @nestjs/throttler 負責（AuthThrottlerGuard）。
 */
@Injectable()
export class LoginAttemptsService {
  private readonly entries = new Map<string, Entry>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly clock: ClockService,
  ) {
    this.limit = config.get('LOGIN_FAILURE_LIMIT', { infer: true });
    this.windowMs =
      config.get('LOGIN_FAILURE_WINDOW_SECONDS', { infer: true }) * 1000;
  }

  /** 已經被鎖住就丟 429（帶 retryAfterSeconds）；沒鎖就什麼都不做 */
  assertAllowed(key: string): void {
    const entry = this.live(key, this.nowMs());
    if (entry && entry.count >= this.limit) {
      throw new AppException('TOO_MANY_REQUESTS', {
        retryAfterSeconds: (entry.windowEndsAt - this.nowMs()) / 1000,
      });
    }
  }

  recordFailure(key: string): void {
    const now = this.nowMs();
    const entry = this.live(key, now);
    if (entry) {
      entry.count += 1;
      return;
    }
    this.entries.set(key, { count: 1, windowEndsAt: now + this.windowMs });
    if (this.entries.size > MAX_TRACKED_EMAILS) this.prune(now);
  }

  /** 登入成功：這個 Email 的失敗次數歸零 */
  reset(key: string): void {
    this.entries.delete(key);
  }

  /** 沒過期的紀錄；過期的順便刪掉 */
  private live(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && now >= entry.windowEndsAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /**
   * 先刪過期的；還是太多就從最舊的開始刪（Map 依加入順序），但跳過鎖住的：
   * 鎖住的要留到視窗結束，否則灌入大量不同的 Email 就能把別人的鎖擠掉。
   * 最後再用硬上限防記憶體被灌爆：每筆鎖住的紀錄要花攻擊者 limit 次請求，正常情況不會到。
   */
  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now >= entry.windowEndsAt) this.entries.delete(key);
    }
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= MAX_TRACKED_EMAILS) break;
      if (entry.count < this.limit) this.entries.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_TRACKED_EMAILS * 5) break;
      this.entries.delete(key);
    }
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }
}
