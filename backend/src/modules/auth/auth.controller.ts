import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiAuth,
  ApiErrors,
  ApiNotImplemented,
} from '../../common/swagger/api-decorators.js';
import { AuthResponseDto, MeDto } from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { Public } from './public.decorator.js';

/**
 * AUTH-1 空殼：register、login 是公開端點（@Public），me 要登入（方法上的 @ApiAuth）。
 * 實作在 AUTH-2（W2）：bcrypt 雜湊、Email 轉小寫、次數限制。
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Post('register')
  @Public()
  @ApiOperation({
    summary: '註冊',
    description: [
      'Email 去除前後空白並轉成小寫後儲存；已經註冊過回 AUTH_EMAIL_TAKEN（比對也用小寫，大小寫不同視為同一個 Email）。',
      '密碼用 bcrypt 雜湊後儲存，回應不含任何密碼資訊。註冊成功直接登入，回傳 token，hasCompletedOnboarding 一定是 false。',
      '同一個 IP 太頻繁會回 429 TOO_MANY_REQUESTS（AUTH-2 加入）。',
    ].join('\n\n'),
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'NAME_INVALID',
    'AUTH_EMAIL_TAKEN',
    'TOO_MANY_REQUESTS',
  )
  @ApiNotImplemented()
  register(@Body() _dto: RegisterDto): AuthResponseDto {
    throw new NotImplementedException();
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: '登入',
    description: [
      'Email 轉成小寫後比對。Email 不存在、密碼錯誤都回 AUTH_INVALID_CREDENTIALS，不透露是哪一個錯。',
      'Email 不存在時也要跑一次 bcrypt 比對，讓兩種情況的回應時間差不多。',
      '同一個 IP 太頻繁會回 429 TOO_MANY_REQUESTS（AUTH-2 加入）。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'AUTH_INVALID_CREDENTIALS',
    'TOO_MANY_REQUESTS',
  )
  @ApiNotImplemented()
  login(@Body() _dto: LoginDto): AuthResponseDto {
    throw new NotImplementedException();
  }

  @Get('me')
  @ApiAuth()
  @ApiOperation({
    summary: '取得登入者資料',
    description:
      '未完成問卷也可以呼叫。token 對應的使用者不存在時（例如資料庫被重設）回 401 AUTH_UNAUTHENTICATED。',
  })
  @ApiOkResponse({ type: MeDto })
  @ApiNotImplemented()
  me(): MeDto {
    throw new NotImplementedException();
  }
}
