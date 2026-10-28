# Money Mate — 前端 Demo（B）

依 **PRD v0.5.8** 做的前端初版，給組員試用、開會討論要改什麼。
**目前還沒有後端**：用瀏覽器內的「假後端」（mock API）模擬 NestJS，資料只存在每個人自己的瀏覽器裡，彼此不會互相影響。

🔗 **Demo 網址：** https://gianni1203.github.io/frontend-moneymate-demo/

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

後端（NestJS）完成後，**頁面不用改**，只要部署時設定環境變數：

```
NUXT_PUBLIC_API_MODE=http
NUXT_PUBLIC_API_BASE=https://<後端網址>/api/v1
```

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

## 部署

推到 `main` 後，GitHub Actions 自動執行 `nuxt generate` 並部署到 GitHub Pages（`.github/workflows/deploy.yml`）。
Nitro preset 用環境變數 `NITRO_PRESET` 切換（`github_pages`／`vercel`／`node_server`），之後搬到 Vercel 或 AWS 不用改程式（PRD §19）。
`ci-artifacts` 分支只是 CI 自動推的建置紀錄，方便除錯，可以忽略。
