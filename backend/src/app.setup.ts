import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { usePinoHttp } from './common/logger.js';
import { parseCorsOrigins, type EnvVars } from './config/env.validation.js';

/**
 * 所有會影響請求行為的設定都只放在這裡（前綴、CORS、安全標頭、代理、pipe、filter、
 * interceptor、useLogger、shutdown hooks），正式程式（main.ts）與 e2e（createTestApp）共用。
 * LoggerModule 的註冊在 AppModule（套件限制），選項在 common/logger.ts。
 * 之後加入：ValidationPipe（INF-4）。
 */
export function configureApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  // Express 層掛一次，/api/docs、/health、/api/v1 都會進。req.ip 在回應結束時才讀。
  usePinoHttp(app);

  const config = app.get<ConfigService<EnvVars, true>>(ConfigService);

  // 一定要傳數字：字串會被 Express 當成 IP 清單；不可寫 true（會信任偽造的 X-Forwarded-For）
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));

  // 財務回應不要留在共用電腦的瀏覽器快取。middleware 才套得到 404／413。
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

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
