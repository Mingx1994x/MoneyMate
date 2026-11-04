# Money Mate — 前端

Nuxt 4（SPA，`ssr: false`）。初版由 B 依 **PRD v0.5.8** 做成，需求以 `docs/` 裡最新版的 PRD 為準。
預設用瀏覽器內的「假後端」（mock API）模擬 NestJS，資料只存在每個人自己的瀏覽器裡，彼此不會互相影響；接上真的後端的方式見「換成真的後端」。

🔗 **網址**（建好 Vercel 專案後補上）：

- 測試機（`dev`）：
- 正式（`main`）：
- 舊版 Demo：https://gianni1203.github.io/frontend-moneymate-demo/

## 試用方式

1. 打開 Demo 網址 → 按 **「用 Demo 帳號登入」**（已有半年記帳資料、帳單、貸款）
2. 或自己 **註冊** 一個帳號，體驗 30 秒問卷 → 從零開始
3. 左下角／右上「⋯」有 **Demo 工具**：
   - **模擬儲存失敗**：所有儲存都回 500，用來看錯誤畫面
   - **重設 Demo 資料**：玩壞了就按這個

### 建議大家試這幾個流程（對照 PRD 驗收標準）

| 流程 | 去哪裡 | 對應 |
|---|---|---|
| 快速記帳：填金額 → 點分類就存好 | 右下角「＋」 | FR-09、AC-21 |
| 繳卡費（銀行 → 信用卡轉帳，不算支出） | 帳戶頁信用卡「繳卡費」 | AC-08 |
| 新增真實帳戶 → 詢問是否從估計值扣掉 | 帳戶頁「新增帳戶」 | §15.9、AC-18 |
| 帳單繳費 → 自動產生下一期；取消繳費；停止重複 | 帳單頁 | §16、AC-10～14 |
| 貸款：輸入 1,000,000／3%／結清日 5 年後 → 自動算出 17,969、總利息 78,120 | 貸款頁「新增貸款」 | §15.8、AC-28 |
| 預先記一筆下個月的收入 → 目前餘額不變 | 快速記帳 →「更多」改日期 | AC-19 |
| Dashboard 一句下一步、14 天資金缺口 | 總覽 | §15.5 |

## 分工標示

頁面上紫色虛線框標「A 負責」「C 負責」的區塊，是 B 先做的**暫時版本**，只為了串起 Demo 流程，之後由負責人改寫：

| 頁面／區塊 | 主責 | 這個 repo 的狀態 |
|---|---|---|
| 登入、註冊 | B | ✅ 初版 |
| 帳戶頁（含估計帳戶轉換） | B | ✅ 初版 |
| 快速記帳＋交易表單（收入／支出／轉帳／繳卡費） | B | ✅ 初版 |
| 帳單頁（繳費、取消繳費、停止重複） | B | ✅ 初版 |
| 貸款頁（含月付自動計算） | B | ✅ 初版 |
| Dashboard 報表區塊（收支、帳單、貸款） | B | ✅ 初版 |
| 共用元件、API client | B | ✅ 初版（型別之後改用 Swagger 產生） |
| Dashboard 第一屏、問卷、目標頁、共用版型 | A | 🟣 暫時版本 |
| 交易列表頁 | C | 🟣 暫時版本 |

## 本機開發

```bash
npm install
npm run dev        # http://localhost:3000
npm run generate   # 產生靜態網站到 .output/public
```

## 架構

```
app/
├─ pages/              每個檔案＝一個頁面（Nuxt 自動路由）
├─ components/         共用元件：AppButton、AppField、MoneyInput、AppModal、StateView（載入/錯誤/空狀態）…
│                      以及表單：TransactionForm、AccountForm、BillForm、LoanForm
├─ composables/
│  ├─ useApi.ts        ⭐ API client：所有頁面只透過它呼叫後端
│  ├─ useAuth.ts       登入狀態、token（localStorage，Bearer）
│  ├─ useResource.ts   讀資料的共用寫法（loading / error / reload）
│  ├─ useDraft.ts      表單草稿（沒送出的內容下次打開還在）、記住上次的帳戶與分類
│  └─ useUi.ts         Toast、確認視窗、快速記帳開關
├─ middleware/         登入保護：沒登入 → /login；沒做問卷 → /onboarding
├─ types/api.ts        ⭐ API 資料格式（之後改由 openapi-typescript 從 Swagger 產生）
├─ lib/                金額、日期（Asia/Taipei）、錯誤代碼對照
└─ mock/               瀏覽器內的假後端（照 PRD §13–16 實作）＋ Demo 資料
```

### 換成真的後端

**頁面不用改**，切換 `NUXT_PUBLIC_API_MODE` 就好：`mock` 是瀏覽器內的假後端，`http` 是連 NestJS（網址用 `NUXT_PUBLIC_API_BASE` 指定）。部署環境要設的值見「部署（Vercel）」→「接上後端」。

`app/mock/` 整個資料夾可以保留給前端單獨開發用，或之後刪除。

### 跟 PRD 對齊的重點

- API 欄位 camelCase、金額是字串（`"1234.00"`）、日期 `YYYY-MM-DD`；**前端不自己算餘額或合計**，數字都來自 API
- 不分頁的列表回 `{ items }`、交易列表回 `{ items, page, pageSize, total }`
- 錯誤依 `code` 顯示中文（`app/lib/api-error.ts`），之後以 E 的 `docs/error-codes.md` 為準
- 收到 401 自動登出回登入頁；token 存 `localStorage`；不使用 `v-html`
- 手機寬度可操作；快速記帳、帳戶、帳單、貸款表單有草稿暫存

## 跟後端對齊的結果

| 項目 | 結論 |
|---|---|
| 不分頁的列表 | 一律包一層 `{ items: [...] }`（E 的統一規則）：`GET /accounts`、`/categories`、`/loans`、`/bills` |
| 刪除帳戶時加回估計值 | `DELETE /accounts/:id?addBackToEstimate=true`；沒帶或 `false` 就不加回（C 確認） |
| 快速記帳「填好金額後點分類就直接存」 | OK（C 確認）；前端一律帶上次使用的 `accountId` 與 `transactionDate` |
| 交易列表篩選參數 | `dateFrom`、`dateTo`、`transactionType`、`categoryId`、`accountId`、`page`、`pageSize` |

### 還沒定的

- **E**：錯誤代碼的完整清單（前端先列了一版，見 `app/lib/api-error.ts`）
- **A**：共用版型（側欄、手機底部導覽、右下角＋）與整體視覺風格

## 部署（Vercel）

PRD 第二十九節第 4 項：W1–W5 前端部署在 Vercel。一個 Vercel 專案分成兩個環境：

| 環境 | 分支 | 什麼時候更新 |
|---|---|---|
| 測試機 | `dev` | PR 合併進 `dev`，而且有改到 `frontend/` |
| 正式 | `main` | 週會確認後，把 `dev` 合併進 `main` |

其他分支與 PR 不會部署；要給大家看畫面，就合併進 `dev` 用測試機看，或在本機 `npm run dev`。

### `vercel.json`

建置不需要設定，Vercel 會自動偵測 Nuxt；`vercel.json` 只管哪些分支要部署。

- `git.deploymentEnabled`：只有 `main`、`dev` 會部署，其他分支（包括 PR）都關掉。
- `ignoreCommand`：這次合併沒有改到 `frontend/` 就跳過，例如只改後端的 PR 合併進 `dev` 時，測試機不會重新部署。Vercel 在 Root Directory 執行這個指令，所以 `.` 指的就是 `frontend/`。

### Vercel 專案設定（只需設定一次）

| 設定 | 值 | 說明 |
|---|---|---|
| Root Directory | `frontend` | repo 根目錄是前後端一起的 monorepo |
| Framework Preset | Nuxt.js | 自動偵測；Build Command、Output Directory 用預設 |
| Node.js Version | 24.x | 與 `.nvmrc` 一致；`package.json` 的 `engines` 也寫了 `24.x` |
| Production Branch | `main` | Settings → Environments → Production → Branch Tracking。**預設是 repo 的預設分支 `dev`，一定要改** |
| Vercel Authentication | 關閉 | Settings → Deployment Protection。測試機在 Vercel 算 Preview，預設要登入專案擁有者的 Vercel 帳號才看得到，不關的話組員打不開 |
| 環境變數 | 先不用設 | 預設 `NUXT_PUBLIC_API_MODE=mock`（瀏覽器內假後端） |

### 接上後端

測試機和正式環境共用同一個後端（Render）和資料庫（Supabase）。

1. Vercel 的 Settings → Environment Variables，Production 和 Preview 都設：
   - `NUXT_PUBLIC_API_MODE=http`
   - `NUXT_PUBLIC_API_BASE=https://moneymate-sclr.onrender.com/api/v1`
2. 改了環境變數要重新部署才會生效（Deployments → 最新一筆 → Redeploy）
3. 請 E 在 Render 的 `CORS_ORIGIN` 加上測試機和正式的網址，用逗號分隔。每一項都要寫完整，例如 `https://<專案名>.vercel.app`（包含 `https://`）；漏掉哪個環境，那個環境呼叫 API 就會被瀏覽器擋掉
