import {
  Controller,
  Get,
  type INestApplication,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  ApiAuth,
  ApiErrors,
  ApiNotImplemented,
} from './common/swagger/api-decorators.js';
import { OPENAPI_EXPORT_ENV } from './openapi/export-env.constants.js';

// 只給這個測試用的 controller，驗證共用標註的輸出
@Controller('docs-check')
@ApiAuth()
class DocsCheckController {
  @Get('stub')
  @ApiOperation({ summary: '空殼端點' })
  @ApiOkResponse()
  @ApiErrors(
    'LOAN_NOT_FOUND',
    ['ACCOUNT_NOT_FOUND', 400],
    'TRANSFER_SAME_ACCOUNT',
  )
  @ApiNotImplemented()
  stub(): void {
    throw new NotImplementedException();
  }
}

@Controller('docs-public')
class DocsPublicController {
  @Post('login')
  @ApiOperation({ summary: '公開端點' })
  @ApiErrors('AUTH_INVALID_CREDENTIALS')
  login(): void {}

  @Get('me')
  @ApiOperation({ summary: '方法層級的 @ApiAuth' })
  @ApiAuth()
  me(): void {}
}

/**
 * 一個檔案只建一種環境的 app：動態 import 會被快取，ConfigModule 只在第一次 import 時驗證。
 * SWAGGER_ENABLED=false 的情況在 swagger-disabled.spec.ts。
 */
describe('Swagger 文件', () => {
  let app: INestApplication<App>;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(OPENAPI_EXPORT_ENV)) {
      vi.stubEnv(key, value);
    }
    // 開發者的 shell 設了 SWAGGER_ENABLED 也不影響「沒設時掛載」的測試
    vi.stubEnv('SWAGGER_ENABLED', undefined);
    // 環境變數要在 import AppModule 之前設好
    const { AppModule } = await import('./app.module.js');
    const { configureApp } = await import('./app.setup.js');
    const { buildOpenApiDocument, setupSwagger } = await import('./swagger.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [DocsCheckController, DocsPublicController],
    }).compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(nestApp);
    app = nestApp;
    setupSwagger(app);
    await app.init();
    doc = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('/health 沒有前綴、業務路徑帶 /api/v1；有 bearer 驗證設定', () => {
    expect(doc.paths['/health']).toBeDefined();
    expect(doc.paths['/api/v1/health']).toBeUndefined();
    expect(doc.paths['/api/v1/docs-check/stub']).toBeDefined();
    expect(doc.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('ErrorResponseDto.code 指向 ErrorCode enum', () => {
    const schemas = doc.components?.schemas ?? {};
    expect(schemas.ErrorCode).toMatchObject({ type: 'string' });
    expect((schemas.ErrorCode as { enum: string[] }).enum).toContain(
      'LOAN_NOT_FOUND',
    );
    const props = (
      schemas.ErrorResponseDto as { properties: Record<string, unknown> }
    ).properties;
    // 實際輸出是 allOf 包 $ref，不是直接的 $ref
    expect(props.code).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/ErrorCode' }],
    });
  });

  it('@ApiErrors 依狀態碼分組；@ApiAuth 在類別上加 401 與 bearer；@ApiNotImplemented 加 501 與前綴', () => {
    const op = doc.paths['/api/v1/docs-check/stub'].get;
    if (op === undefined) throw new Error('找不到 GET /api/v1/docs-check/stub');
    expect(op.operationId).toBe('DocsCheck_stub');
    expect(op.summary).toBe('【未實作】空殼端點');
    expect(op.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(op.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '501',
    ]);
    const description = (status: string) =>
      (op.responses[status] as { description: string }).description;
    expect(description('400')).toBe(
      '`ACCOUNT_NOT_FOUND`：找不到這個帳戶\n\n`TRANSFER_SAME_ACCOUNT`：不能轉帳給同一個帳戶',
    );
    expect(description('404')).toBe('`LOAN_NOT_FOUND`：找不到這筆貸款');
    expect(description('401')).toContain('AUTH_UNAUTHENTICATED');
  });

  it('@ApiErrors 的 [代碼, 狀態碼] 受代碼表限制', () => {
    const ok = () => ApiErrors(['ACCOUNT_NOT_FOUND', 400]);
    const bad = () =>
      // @ts-expect-error LOAN_NOT_FOUND 只允許 404
      ApiErrors(['LOAN_NOT_FOUND', 400]);
    expect(ok).not.toThrow();
    expect(bad).not.toThrow(); // 只靠型別擋，執行期不檢查
  });

  it('公開端點沒有 bearer；@ApiAuth 加在方法上也有效', () => {
    const login = doc.paths['/api/v1/docs-public/login'].post;
    expect(login?.security).toBeUndefined();
    expect(login?.summary).toBe('公開端點');
    expect(Object.keys(login?.responses ?? {})).toContain('401');
    expect(doc.paths['/api/v1/docs-public/me'].get?.security).toEqual([
      { bearer: [] },
    ]);
  });

  it('每個 operation 都有非空的 summary', () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const op = item[method];
        if (op === undefined) continue;
        expect(op.summary, `${method.toUpperCase()} ${path}`).toBeTruthy();
      }
    }
  });

  it('SWAGGER_ENABLED 沒設（development）時掛載：JSON 在 /api/docs-json，不提供 YAML', async () => {
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    await request(app.getHttpServer()).get('/api/docs-yaml').expect(404);
  });
});
