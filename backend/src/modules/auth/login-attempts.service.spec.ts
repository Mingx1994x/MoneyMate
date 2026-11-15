import { ConfigService } from '@nestjs/config';
import { FakeClock } from '../../../test/utils/fake-clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { EnvVars } from '../../config/env.validation.js';
import { LoginAttemptsService } from './login-attempts.service.js';

function setup(
  limit = 3,
  windowSeconds = 60,
): { clock: FakeClock; attempts: LoginAttemptsService } {
  const clock = new FakeClock('2026-10-29T00:00:00Z');
  // 只放這個 service 讀的兩個值
  const config = new ConfigService<EnvVars, true>({
    LOGIN_FAILURE_LIMIT: limit,
    LOGIN_FAILURE_WINDOW_SECONDS: windowSeconds,
  });
  return { clock, attempts: new LoginAttemptsService(config, clock) };
}

/** 回傳丟出的 AppException；沒丟就回 undefined */
function thrown(fn: () => void): AppException | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }
}

describe('LoginAttemptsService', () => {
  it('還沒達到上限：不擋', () => {
    const { attempts } = setup(3);
    attempts.recordFailure('a@example.com');
    attempts.recordFailure('a@example.com');
    expect(thrown(() => attempts.assertAllowed('a@example.com'))).toBe(
      undefined,
    );
  });

  it('達到上限：429 TOO_MANY_REQUESTS，retryAfterSeconds 是視窗剩下的秒數', () => {
    const { attempts, clock } = setup(3, 60);
    attempts.recordFailure('a@example.com'); // 視窗從這裡開始，到 00:01:00
    clock.set('2026-10-29T00:00:20Z');
    attempts.recordFailure('a@example.com');
    attempts.recordFailure('a@example.com');
    const error = thrown(() => attempts.assertAllowed('a@example.com'));
    expect(error?.code).toBe('TOO_MANY_REQUESTS');
    expect(error?.getStatus()).toBe(429);
    expect(error?.opts.retryAfterSeconds).toBe(40);
  });

  it('視窗到期就解鎖，而且從頭計算', () => {
    const { attempts, clock } = setup(2, 60);
    attempts.recordFailure('a@example.com');
    attempts.recordFailure('a@example.com');
    expect(thrown(() => attempts.assertAllowed('a@example.com'))).toBeDefined();
    clock.set('2026-10-29T00:01:00Z'); // 剛好 60 秒
    expect(thrown(() => attempts.assertAllowed('a@example.com'))).toBe(
      undefined,
    );
    attempts.recordFailure('a@example.com'); // 新視窗的第 1 次
    expect(thrown(() => attempts.assertAllowed('a@example.com'))).toBe(
      undefined,
    );
  });

  it('reset 之後歸零；不同的鍵各自計數', () => {
    const { attempts } = setup(1);
    attempts.recordFailure('a@example.com');
    attempts.recordFailure('b@example.com');
    attempts.reset('a@example.com');
    expect(thrown(() => attempts.assertAllowed('a@example.com'))).toBe(
      undefined,
    );
    expect(thrown(() => attempts.assertAllowed('b@example.com'))).toBeDefined();
  });

  it('最多記 10,000 個 Email：超過時丟掉最舊的「還沒鎖住」紀錄，記憶體不會一直長', () => {
    const { attempts } = setup(2);
    attempts.recordFailure('oldest@example.com'); // 1 次，還沒鎖住
    for (let i = 0; i < 10_000; i += 1) {
      attempts.recordFailure(`spam${i}@example.com`);
    }
    // 最舊的被丟掉了：再失敗 1 次是新的第 1 次，不會鎖
    attempts.recordFailure('oldest@example.com');
    expect(thrown(() => attempts.assertAllowed('oldest@example.com'))).toBe(
      undefined,
    );
  });

  it('鎖住的紀錄不會被擠掉：灌入 10,000 個不同的 Email 也解不開別人的鎖', () => {
    const { attempts } = setup(1);
    attempts.recordFailure('victim@example.com');
    expect(
      thrown(() => attempts.assertAllowed('victim@example.com')),
    ).toBeDefined();
    for (let i = 0; i < 10_000; i += 1) {
      attempts.recordFailure(`spam${i}@example.com`);
    }
    expect(
      thrown(() => attempts.assertAllowed('victim@example.com')),
    ).toBeDefined();
  });
});
