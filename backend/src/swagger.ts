import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { ErrorResponseDto } from './common/errors/error-response.dto.js';
import { isSwaggerEnabled, type EnvVars } from './config/env.validation.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const NOT_IMPLEMENTED_PREFIX = '【未實作】';

/** setupSwagger 與 openapi:export 共用，兩邊的文件才會一致 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Money Mate API')
    .setDescription(
      [
        '金額為字串（例如 "1234.00"）、日期為 YYYY-MM-DD、時間戳為 ISO 8601 UTC。',
        `標示${NOT_IMPLEMENTED_PREFIX}的端點目前回 501。`,
        '錯誤代碼見 repo 的 docs/error-codes.md。',
      ].join('\n\n'),
    )
    // 固定版號：不讀 package.json，避免改版號就讓 openapi.json 出現 diff
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
    // 還沒有端點引用時也輸出 ErrorResponseDto 與 ErrorCode，前端從第一天就拿得到代碼的聯集型別
    extraModels: [ErrorResponseDto],
  });
  markNotImplemented(document);
  return document;
}

/** 有 501 回應（@ApiNotImplemented）的端點，summary 前加上「【未實作】」 */
function markNotImplemented(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation?.responses['501'] === undefined) continue;
      operation.summary = `${NOT_IMPLEMENTED_PREFIX}${operation.summary ?? ''}`;
    }
  }
}

/**
 * Swagger UI 在 /api/docs、JSON 在 /api/docs-json（不在 /api/v1 底下）。
 * 開關的判斷放在這裡而不是 main.ts，測試才測得到。e2e 不呼叫。
 */
export function setupSwagger(app: INestApplication): void {
  const config = app.get<ConfigService<EnvVars, true>>(ConfigService);
  const env = {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
  };
  if (!isSwaggerEnabled(env)) return;

  SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    raw: ['json'],
    customSiteTitle: 'Money Mate API',
    swaggerOptions: {
      // 正式環境不把 token 存進 localStorage
      persistAuthorization: env.NODE_ENV !== 'production',
    },
  });
}
