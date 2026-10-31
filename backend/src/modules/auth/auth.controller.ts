import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-decorators.js';
import type { AuthUser } from './auth-user.js';
import { AuthService } from './auth.service.js';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import { AuthResponseDto, MeDto } from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { Public } from './public.decorator.js';

/** register、login 是公開端點（@Public），me 要登入（方法上的 @ApiAuth；JwtAuthGuard 是全域的） */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @ApiOperation({
    summary: '註冊',
    description: [
      'Email 去除前後空白並轉成小寫後儲存（只接受半形英數與符號）；已經註冊過回 AUTH_EMAIL_TAKEN（比對也用小寫，大小寫不同視為同一個 Email）。兩個請求同時註冊同一個 Email，只有一個成功。',
      '密碼用 bcrypt 雜湊後儲存，回應不含任何密碼資訊。註冊成功直接登入，回傳 token，hasCompletedOnboarding 一定是 false。',
      '次數限制（PRD FR-03）：每個 IP 每分鐘最多 10 次（上限是 AUTH_IP_LIMIT_PER_MINUTE，測試環境調高），超過回 429 TOO_MANY_REQUESTS，並帶 retryAfterSeconds。只在單一後端實例有效。',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'NAME_INVALID',
    'AUTH_EMAIL_TAKEN',
    'TOO_MANY_REQUESTS',
  )
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: '登入',
    description: [
      'Email 轉成小寫後比對。Email 不存在、密碼錯誤都回 AUTH_INVALID_CREDENTIALS，不透露是哪一個錯；Email 不存在時也會跑一次 bcrypt 比對，讓兩種情況的回應時間差不多。',
      '次數限制（PRD FR-03），兩條都要：\n1. 每個 IP 每分鐘最多 10 次（成功、失敗都算；AUTH_IP_LIMIT_PER_MINUTE）。\n2. 每個 Email（轉成小寫後）每 15 分鐘最多失敗 5 次（LOGIN_FAILURE_LIMIT、LOGIN_FAILURE_WINDOW_SECONDS）；超過後這個 Email 在視窗結束前一律回 429，即使密碼正確也一樣。Email 不存在的失敗也會計算，所以從 429 看不出 Email 有沒有註冊。登入成功會把這個 Email 的失敗次數歸零。',
      '超過任一條都回 429 TOO_MANY_REQUESTS，並帶 retryAfterSeconds。計數存在記憶體，只在單一後端實例有效（PRD 第十九節）；測試環境用環境變數調高上限。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AUTH_INVALID_CREDENTIALS',
    'TOO_MANY_REQUESTS',
  )
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.auth.login(dto);
  }

  @Get('me')
  @ApiAuth()
  @ApiOperation({
    summary: '取得登入者資料',
    description:
      '未完成問卷也可以呼叫，hasCompletedOnboarding 是 false（有目標資料才是 true）。token 對應的使用者不存在時（例如資料庫被重設）回 401 AUTH_UNAUTHENTICATED。',
  })
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }
}
