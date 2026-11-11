import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { buildOpenApiDocument } from '../src/swagger.js';
import { createTestApp } from './utils/create-test-app.js';
import { TEST_USER_ID } from './utils/test-token.js';

/** 不需要登入的端點。新增公開端點時要改這裡，審查的人才看得到 */
const PUBLIC_OPERATIONS = [
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'GET /health',
];

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Operation {
  method: (typeof METHODS)[number];
  path: string;
  /** OpenAPI 上有 security（Swagger 顯示鎖頭，也就是有 @ApiAuth()） */
  secured: boolean;
}

function listOperations(doc: OpenAPIObject): Operation[] {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method]).map((method) => ({
      method,
      path,
      secured: (item[method]?.security ?? []).length > 0,
    })),
  );
}

const label = (op: Operation): string =>
  `${op.method.toUpperCase()} ${op.path}`;

/**
 * AUTH-1（E）：PRD AC-01「未登入呼叫業務 API 回 401」對所有端點成立。
 * 端點清單從 OpenAPI 文件（buildOpenApiDocument，和 openapi:export 同一個函式）展開，
 * 之後新增的端點自動被涵蓋；誤加 @Public() 或忘了 @ApiAuth() 都會讓這裡失敗。
 * 限制：用 @ApiExcludeController／@ApiExcludeEndpoint 從 Swagger 拿掉的端點不會被檢查（目前沒有）。
 * 壞 token 的各種情況在 auth.e2e-spec.ts。
 */
describe('所有端點的登入檢查（e2e，AC-01）', () => {
  let app: INestApplication<App>;
  let operations: Operation[];

  beforeAll(async () => {
    app = await createTestApp();
    operations = listOperations(buildOpenApiDocument(app));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('OpenAPI 上沒有鎖頭的端點剛好就是白名單', () => {
    const unsecured = operations.filter((op) => !op.secured).map(label);
    expect(unsecured.sort()).toEqual([...PUBLIC_OPERATIONS].sort());
  });

  it('白名單以外的端點，不帶 token 一律回 401 AUTH_UNAUTHENTICATED', async () => {
    const guarded = operations.filter(
      (op) => !PUBLIC_OPERATIONS.includes(label(op)),
    );
    // 至少要有東西可測，避免文件是空的時候這條默默通過
    expect(guarded.length).toBeGreaterThan(20);

    const failures: string[] = [];
    for (const op of guarded) {
      const path = op.path.replace(/\{[^}]+\}/g, TEST_USER_ID);
      // 不送 body、不帶 query：guard 在 pipe 之前執行，內容不合法也應該先回 401
      const res = await request(app.getHttpServer())[op.method](path);
      const code = (res.body as { code?: string }).code;
      if (res.status !== 401 || code !== 'AUTH_UNAUTHENTICATED') {
        failures.push(`${label(op)} → ${res.status} ${code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('白名單裡的端點不帶 token 不是 401', async () => {
    const failures: string[] = [];
    for (const entry of PUBLIC_OPERATIONS) {
      const [method, path] = entry.split(' ');
      const res = await request(app.getHttpServer())[
        method.toLowerCase() as Operation['method']
      ](path);
      if (res.status === 401) failures.push(entry);
    }
    expect(failures).toEqual([]);
  });
});
