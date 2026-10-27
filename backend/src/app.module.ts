import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { GoalsModule } from './modules/goals/goals.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { LoansModule } from './modules/loans/loans.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { PrismaModule } from './prisma/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      // openapi:export 只用固定的假變數，不受個人 .env 影響（src/openapi/export-env.ts）
      ignoreEnvFile: process.env.OPENAPI_EXPORT === '1',
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    LoansModule,
    OnboardingModule,
    GoalsModule,
  ],
})
export class AppModule {}
