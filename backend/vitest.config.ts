import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // 時區固定 UTC，本機（Asia/Taipei）與 CI 結果才會一致；不能寫在 npm script（Windows cmd 不支援）
    env: { NODE_ENV: 'test', TZ: 'UTC' },
  },
});
