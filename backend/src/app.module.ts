import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ClockModule } from './clock/clock.module.js';
import { createPinoLoggerParams } from './common/logger.js';
import { validateEnv } from './config/env.validation.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { GoalsModule } from './modules/goals/goals.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { LoansModule } from './modules/loans/loans.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { TransactionsModule } from './modules/transactions/transactions.module.js';
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
    // 只能在 root 呼叫一次。真正的 middleware 在 configureApp 的 usePinoHttp（每個路徑）。
    // 這裡的 forRoutes 指到不會打到的路徑，避免套件再掛一次、每個請求寫兩筆。
    LoggerModule.forRoot({
      ...createPinoLoggerParams(),
      forRoutes: [{ path: '/__pino_unused__', method: RequestMethod.ALL }],
    }),
    PrismaModule,
    ClockModule,
    AuthModule,
    HealthModule,
    LoansModule,
    OnboardingModule,
    GoalsModule,
    CategoriesModule,
    AccountsModule,
    TransactionsModule,
    DashboardModule,
  ],
})
export class AppModule {}
