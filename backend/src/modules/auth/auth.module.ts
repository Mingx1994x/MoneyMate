import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import type { EnvVars } from '../../config/env.validation.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { ACCESS_TOKEN_TTL_SECONDS, TokenService } from './token.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
      }),
    }),
    // 只提供給 AuthThrottlerGuard（註冊、登入的每個 IP 次數限制）；沒有掛 APP_GUARD，其他端點不受影響
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: config.get('AUTH_IP_LIMIT_PER_MINUTE', { infer: true }),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginAttemptsService,
    TokenService,
    AuthThrottlerGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}
