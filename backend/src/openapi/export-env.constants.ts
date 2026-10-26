/**
 * openapi:export 用的固定假環境變數（不連資料庫，DATABASE_URL 是連不到的位址）。
 * 這個檔案沒有副作用，swagger.spec.ts 搭配 vi.stubEnv 使用；
 * 新增必填環境變數時要在這裡補假值，漏了 npm test 會失敗。
 */
export const OPENAPI_EXPORT_ENV = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://openapi:openapi@127.0.0.1:1/openapi_export',
  CORS_ORIGIN: 'http://localhost:3000',
  OPENAPI_EXPORT: '1',
} as const;
