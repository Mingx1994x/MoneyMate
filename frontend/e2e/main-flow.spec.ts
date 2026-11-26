import { expect, test } from '@playwright/test'

// 跟後端 seed:e2e 用同一個值（docs/e2e-fixtures.md）；CI 由 playwright job 設定
const password = process.env.E2E_PASSWORD ?? ''
if (password.length < 8) throw new Error('請設定 E2E_PASSWORD（8 字元以上，跟後端 seed:e2e 同一個）')

// 主流程（PRD 20.2）：註冊 → 問卷 → Dashboard。
// 註冊本身也要測，所以每次註冊新帳號，不用 D 的固定帳號（e2e-new 只讀不改）。
test('主流程：註冊 → 問卷 → Dashboard', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@moneymate.test`)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: '註冊' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)

  // Q1 用預選的 4 萬；Q2 選 10 萬（建立 100,000 的「現有存款」帳戶，D-D-004）
  await page.getByRole('button', { name: '下一題' }).click()
  await page.getByRole('button', { name: '10 萬', exact: true }).click()
  await page.getByRole('button', { name: '看我的目標' }).click()

  // 結果頁（PRD 第四節「看到目標金額與第一站進度」）：4 萬 × 300 = 1,200 萬；
  // 里程碑（15.4）是 10 萬、100 萬、600 萬、1,200 萬，存款 10 萬剛好達成第 1 站，下一站是第 2 站
  await expect(page.getByText('1,200 萬', { exact: true })).toBeVisible()
  await expect(page.getByText('再存 NT$900,000 就到第 2 站（第一桶金）！')).toBeVisible()

  // 第一屏（#86）還沒接上 API，先檢查報表區塊有載入；#86 完成後補第一屏的內容
  await page.getByRole('button', { name: '開始記帳' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: '報表' })).toBeVisible()

  // 重新整理後仍在 Dashboard、沒被導回問卷：登入狀態與問卷結果都有保存（W2 最小流程 ⑤）
  await page.reload()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: '報表' })).toBeVisible()
})
