import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: { NODE_ENV: 'test', TZ: 'UTC' },
    // 所有 e2e 共用同一個 app_test 資料庫，不能並行
    fileParallelism: false,
  },
});
