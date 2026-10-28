import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { AppException } from '../../common/errors/app.exception.js';
import { Prisma, PrismaService } from '../../prisma/index.js';
import { attemptKey, normalizeEmail } from './auth-email.js';
import type { AuthResponseDto, MeDto } from './dto/auth-response.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { TokenService } from './token.service.js';

/** bcrypt 的成本：每加 1 計算時間變 2 倍。10 在一般主機上約 0.1 秒，擋暴力破解夠用、登入不會卡 */
const BCRYPT_COST = 10;
/** bcrypt 只看密碼的前 72 bytes（PRD 第十三節：密碼 8–72 字元）；超過的部分會被默默忽略 */
const MAX_PASSWORD_BYTES = 72;
/**
 * 不屬於任何人的雜湊（隨機字串產生的）。Email 不存在時也跑一次 compare，
 * 讓「Email 不存在」和「密碼錯誤」的回應時間差不多，不能從時間猜出 Email 有沒有註冊。
 */
const DUMMY_HASH =
  '$2b$10$vCv577Yi1RQlEhpW4WpDzeRaeiu6DOSEMf/gVQ9Wp..lIILMwmxPq';

/** 回應要用的欄位；不含 passwordHash。goal 只用來判斷有沒有完成問卷 */
const ME_SELECT = {
  id: true,
  email: true,
  displayName: true,
  goal: { select: { id: true } },
} satisfies Prisma.UserSelect;

type UserForMe = Prisma.UserGetPayload<{ select: typeof ME_SELECT }>;

function toMe(user: UserForMe): MeDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    // 有目標資料＝已完成問卷
    hasCompletedOnboarding: user.goal !== null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly attempts: LoginAttemptsService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const {
      email: rawEmail,
      password,
      displayName: rawName,
    } = readCredentials(dto);
    const email = normalizeEmail(rawEmail);
    const displayName = normalizeDisplayName(rawName);
    const passwordHash = await hash(password, BCRYPT_COST);

    try {
      // 不先查有沒有重複：資料庫的 unique 才是唯一的依據（兩個請求同時註冊也只會有一個成功）
      const user = await this.prisma.user.create({
        data: { email, passwordHash, displayName },
        select: ME_SELECT,
      });
      return await this.issue(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.forField('AUTH_EMAIL_TAKEN', 'email');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const { email: rawEmail, password } = readCredentials(dto);
    const email = normalizeEmail(rawEmail);
    const key = attemptKey(email);
    // 先檢查有沒有被鎖：鎖住期間即使密碼正確也回 429
    this.attempts.assertAllowed(key);

    const found = await this.prisma.user.findUnique({
      where: { email },
      select: { ...ME_SELECT, passwordHash: true },
    });
    // Email 不存在也要比對一次（DUMMY_HASH），見上方說明
    const passwordOk = await verifyPassword(
      password,
      found?.passwordHash ?? DUMMY_HASH,
    );
    if (!found || !passwordOk) {
      this.attempts.recordFailure(key);
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    this.attempts.reset(key);
    return this.issue(found);
  }

  /** token 對應的使用者不存在（例如資料庫被重設）時回 401，前端會導向登入頁 */
  async me(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ME_SELECT,
    });
    if (!user) throw new AppException('AUTH_UNAUTHENTICATED');
    return toMe(user);
  }

  private async issue(user: UserForMe): Promise<AuthResponseDto> {
    return {
      accessToken: await this.tokens.signAccessToken({ id: user.id }),
      user: toMe(user),
    };
  }
}

async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  // 超過 72 bytes 的密碼不可能是當初設定的（註冊時有擋）；不比對，免得「前 72 bytes 相同」就通過
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return false;
  return compare(password, passwordHash);
}

/**
 * 取出 email、password（一定是字串）。全域 ValidationPipe（INF-4）還沒合併時，
 * 沒送 body 會讓 dto 整個是 undefined、少欄位會讓 `.trim()` 丟 TypeError，都變成 500；
 * 這裡是最後一道防線，改回 400 VALIDATION_FAILED。有 pipe 之後不會走到。
 */
function readCredentials(dto: unknown): {
  email: string;
  password: string;
  displayName: unknown;
} {
  const body = (typeof dto === 'object' && dto !== null ? dto : {}) as Record<
    string,
    unknown
  >;
  const { email, password, displayName } = body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new AppException('VALIDATION_FAILED');
  }
  return { email, password, displayName };
}

/** 顯示名稱：去除前後空白，空白當作沒填（null）。長度（1–30 字）由 DTO 的 @IsName 檢查 */
function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}
