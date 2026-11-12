# Money Mate — 前端

Nuxt 4（SPA，`ssr: false`）。初版由 B 依 **PRD v0.5.8** 做成，需求以 `docs/` 裡最新版的 PRD 為準。
資料都來自 NestJS 後端（`backend/`）；本機怎麼連見「連本機後端開發」，部署環境見「部署（Vercel）」。

🔗 **網址**：

- 測試機（`dev`）：https://money-mate-tan-dev.vercel.app
- 正式（`main`）：https://money-mate-tan.vercel.app（第一次把 `dev` 合併進 `main` 後才會有畫面）
- 舊版 Demo：https://gianni1203.github.io/frontend-moneymate-demo/

## 試用方式

打開測試機網址，自己註冊一個帳號。測試機和正式共用同一個資料庫，請用測試帳號，不要填真實的財務資料。

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

## 連本機後端開發

預設連本機的 NestJS 後端（`http://localhost:3001`）：

1. 依 `backend/README.md` 啟動資料庫與後端（`docker compose up -d`、`npm run start:dev`，後端在 `http://localhost:3001`）
2. 在 `frontend/` 複製 `.env.example` 成 `.env`（裡面已設好 `NUXT_PUBLIC_API_MODE=http` 與後端網址）
3. `npm run dev`，打開 `http://localhost:3000`

- 後端的 `CORS_ORIGIN` 預設就是 `http://localhost:3000`，照 `backend/.env.example` 建 `.env` 就不用改。
- ⚠️ 問卷 API（`POST /onboarding`）還沒完成，`.env.example` 先打開 `NUXT_PUBLIC_SKIP_ONBOARDING=true`，登入後不會被導去問卷頁。問卷 API 完成後移除這個開關。
- 還沒實作的 API 會回 501，畫面會顯示「這個功能還在開發中」。

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
├─ types/
│  ├─ openapi.ts      從 backend/openapi.json 產生的型別（npm run api:types，不要手動改）
│  └─ api.ts          ⭐ 常用型別的短名字（Account、Transaction…），頁面從這裡 import
├─ lib/                金額、日期（Asia/Taipei）、錯誤訊息
└─ mock/               初版用的瀏覽器內假後端＋ Demo 資料（用自己的舊型別 mock/types.ts，逐步淘汰）
```

### 呼叫後端

所有頁面都透過 `useApi` 呼叫後端，網址用 `NUXT_PUBLIC_API_BASE` 指定（本機預設 `http://localhost:3001/api/v1`）。部署環境要設的值見「部署（Vercel）」→「接上後端」。

`app/mock/` 是初版用的瀏覽器內假後端（`NUXT_PUBLIC_API_MODE=mock`），正在逐步淘汰。

### API 型別

型別從後端的 `backend/openapi.json` 產生，不手寫：

```bash
npm run api:types    # 產生 app/types/openapi.ts
npm run typecheck    # 頁面用到不存在或改名的欄位會報錯
```

- 後端合併了新的 API（`openapi.json` 有變）之後，前端在下一個 PR 執行 `npm run api:types` 並 commit。
- CI 會用 PR 裡的 `openapi.json` 重新產生型別再 typecheck：後端改名或刪掉前端還在用的欄位時 CI 失敗；進版控的型別檔過期只會出現警告。
- 貸款、帳單的型別暫時手寫（後端還是 501），#60、#61 接 API 時改用產生的型別。

### 跟 PRD 對齊的重點

- API 欄位 camelCase、金額是字串（`"1234.00"`）、日期 `YYYY-MM-DD`；**前端不自己算餘額或合計**，數字都來自 API
- 不分頁的列表回 `{ items }`、交易列表回 `{ items, page, pageSize, total }`
- 錯誤訊息直接顯示後端回傳的 `message`（`docs/error-codes.md`）；只有前端自己的代碼（連不上後端的 `NETWORK_ERROR`）用 `app/lib/api-error.ts` 的文字
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
| Production Branch | `main` | Settings → Environments → Production → Branch Tracking。Vercel 有 `main` 就會優先選它，確認是 `main` 就好 |
| 測試機網址 | `money-mate-tan-dev.vercel.app` | Settings → Domains，環境選 Preview、Git Branch 填 `dev`。正式網址 `money-mate-tan.vercel.app` 是建專案時自動加的 |
| Vercel Authentication | 關閉 | Settings → Deployment Protection。測試機在 Vercel 算 Preview，預設要登入專案擁有者的 Vercel 帳號才看得到，不關的話組員打不開 |
| 環境變數 | 見「接上後端」 | Production、Preview 分開設 |

### 接上後端

測試機和正式環境共用同一個後端（Render）和資料庫（Supabase）。

1. Vercel 的 Settings → Environment Variables，類型選 Config（這些值本來就會送到瀏覽器，不是祕密），Development 不用勾：

   | 變數 | 值 | 環境 |
   |---|---|---|
   | `NUXT_PUBLIC_API_MODE` | `http` | Production、Preview |
   | `NUXT_PUBLIC_API_BASE` | `https://moneymate-sclr.onrender.com/api/v1` | Production、Preview |
   | `NUXT_PUBLIC_SKIP_ONBOARDING` | `true` | 只有 Preview。⚠️ 暫時的，問卷 API 完成後刪掉 |

2. 改了環境變數要重新部署才會生效（Deployments → 最新一筆 → Redeploy）。最新一筆沒有改到 `frontend/` 的話，要取消勾選 Use project's Ignore Build Step，不然會被跳過
3. Render 的 `CORS_ORIGIN` 要包含 `https://money-mate-tan-dev.vercel.app` 和 `https://money-mate-tan.vercel.app`（用逗號分隔，包含 `https://`）；漏掉哪個環境，那個環境呼叫 API 就會被瀏覽器擋掉
