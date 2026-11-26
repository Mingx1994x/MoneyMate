import { defineConfig, devices } from '@playwright/test'

/**
 * 端到端測試（PRD 20.2），本機與 CI 都對本機的前端＋後端跑。
 * CI 的 playwright job（.github/workflows/ci.yml）自己啟動前後端，所以這裡不設 webServer。
 * 檔名、testDir、PLAYWRIGHT_BASE_URL、E2E_PASSWORD 是跟 CI 的約定（PR #103），要改先跟 E 確認。
 */
export default defineConfig({
  testDir: 'e2e',
  // CI 不重試：測試不穩定時要修測試，不靠重跑
  retries: 0,
  // 所有測試共用同一個資料庫和 D 的固定帳號，一次只跑一個
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
