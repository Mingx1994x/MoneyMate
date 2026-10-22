import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // 時區固定 UTC，本機（Asia/Taipei）與 CI 結果才會一致；不能寫在 npm script（Windows cmd 不支援）
    env: { NODE_ENV: 'test', TZ: 'UTC' },
  },
});
