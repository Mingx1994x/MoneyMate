import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { parseCorsOrigins, type EnvVars } from './config/env.validation.js';

/**
 * 所有會影響請求行為的設定都只放在這裡（前綴、CORS、安全標頭、代理、pipe、filter、
 * interceptor、useLogger、shutdown hooks），正式程式（main.ts）與 e2e（createTestApp）共用。
 * 之後加入：ValidationPipe（INF-4）、日誌（INF-5）、trust proxy（DEP-2）。
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<EnvVars, true>>(ConfigService);

  // 安全標頭（同 helmet 8 的預設值）必須在 enableCors 之前：兩者都在呼叫當下掛上
  // middleware，cors 會直接結束預檢回應，排在後面的話預檢不帶安全標頭。
  app.disable('x-powered-by');
  app.useSecurityHeaders();

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.enableCors({
    // 完整字串比對，不用 regex（不允許 *.vercel.app 這類寫法）
    origin: parseCorsOrigins(config.get('CORS_ORIGIN', { infer: true })),
    credentials: false,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();
}
