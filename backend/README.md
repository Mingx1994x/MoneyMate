# Money Mate 後端

NestJS 12（ESM）＋ Prisma 7 ＋ PostgreSQL 16。測試用 Vitest＋Supertest，lint 用 oxlint。

## 需求

- Node **24.15 以上**（見 `.nvmrc`）
- Docker（本機 PostgreSQL）

## 本機啟動

```bash
# 1. 在 repo 根目錄啟動資料庫（第一次會建立 app_dev 與 app_test）
docker compose up -d

# 2. 在 backend/ 安裝套件（postinstall 會產生 Prisma client）
npm ci

# 3. 建立本機環境變數
cp .env.example .env

# 4. 啟動，打開 http://localhost:3001/health 應回 {"status":"ok"}
npm run start:dev
```

少了必要的環境變數時，啟動會失敗並列出缺少的變數名稱。

## 測試

```bash
cp .env.test.example .env.test   # 第一次
npm test                          # 單元測試
npm run test:e2e                  # e2e：會先確認連的是 *_test 資料庫，再跑 migrate
```

`.env.test` 一定要指向 `app_test`。`db:test:prepare` 與 `createTestApp` 都會檢查資料庫名稱，不是 `*_test` 就直接失敗，避免清掉開發資料。

## 常用指令

| 指令                               | 用途                                        |
| ---------------------------------- | ------------------------------------------- |
| `npm run lint`                     | oxlint（type-aware），warning 也算失敗      |
| `npm run typecheck`                | `tsc --noEmit`                              |
| `npm run format` ／ `format:check` | Prettier 格式化／檢查                       |
| `npm run build`                    | 編譯到 `dist/`                              |
| `npm run db:migrate`               | 建立並套用 migration（本機，D 負責 schema） |
| `npm run db:deploy`                | 只套用既有 migration（部署用）              |

Prisma 一律透過上面的 npm scripts 執行。**不要用 `npx prisma`**（沒裝時會自動下載 `latest`，目前是 8 RC），也不要照 Prisma 的更新提示執行 `npm i prisma@latest`。

## 開發慣例（摘要）

- **ESM**：相對 import 要寫 `.js` 副檔名，例如 `import { AppModule } from './app.module.js'`。
- **新模組**：`nest g module modules/<name>`，會建在 `src/modules/<name>/`。
- **Prisma 型別**：一律從 `src/prisma/index.js` 匯入，不要直接 import `src/generated/`（lint 會擋）。
- **資料庫交易**：由 controller 直接呼叫的 service 方法開 `this.prisma.$transaction(async (tx) => …)`；跨模組的寫入方法第一個參數是 `tx: PrismaTx`，參數有 `tx` 的方法內不得再開交易。
- **關聯寫入一律用純量欄位**：`data: { userId, accountId, … }`，不用 `account: { connect: { id } }`。
- **時間**：程序時區固定 UTC；台北的「今天」之後由 `ClockService` 提供，不要自己 `new Date()` 算日期。
- **金額**（`src/common/money.ts`）：
  - service 之間一律用 `Prisma.Decimal`，不轉成 `number`。
  - 請求的金額字串用 `toMoney(s)` 轉換，不直接 `new Prisma.Decimal(s)`（它連 `'0x10'`、`'1e3'` 都收）。
  - 回應用 `toMoneyString(d)`，固定 2 位小數。它**不會進位**：超過 2 位小數直接丟錯。有除法、平均的計算要自己寫 `d.toDecimalPlaces(n, Prisma.Decimal.ROUND_HALF_UP)`，測試資料要有除不盡的值。
  - 判斷正負用 `gt(0)`、`gte(0)`、`lt(0)`，不用 `isNeg()`（`'-0'` 的 `isNeg()` 是 `true`）。
  - 可為 null 的欄位與沒有資料時的 `_sum` 先處理，例如 `agg._sum.amount ?? new Prisma.Decimal(0)`。
  - 百分比、利率不是金額，不用這組工具。
- **日期**（`src/common/date-only.ts`）：
  - service 內部一律用字串 `DateOnly`（`YYYY-MM-DD`），可以直接用 `<`、`===` 比較。
  - 只在讀寫 Prisma 時用 `toDbDate`／`fromDbDate` 轉換；`fromDbDate` 只接受 `@db.Date` 欄位的值，傳時間戳會丟錯。
  - 日期運算用 `addDays`、`monthOf`、`monthStart`、`nextMonthStart`，不要自己 `setUTCDate`，也不要用 `new Date(y, m, d)`、`getDate()`。日期範圍是 1900–2999，超出就丟錯。
  - 查某月的資料用半開區間：`{ gte: toDbDate(monthStart(m)), lt: toDbDate(nextMonthStart(m)) }`。
- **DTO 驗證**（`src/common/validators.ts`）：
  - 金額欄位用 `@IsMoney({ sign })`，`sign` 必填：`'positive'`（> 0）、`'nonNegative'`（≥ 0）、`'any'`（可為負，正負在 service 檢查）。
  - 日期欄位用 `@IsDateOnly()`（`@Matches` 擋不住 2/30）；月份參數（例如 `?month=2026-10`）用 `@IsMonth()`。
  - `PATCH` 裡不可為空的欄位用 `@ValidateIf((_, v) => v !== undefined)`；`@IsOptional()` 會放過 `null`，只用在可為空的欄位。
  - 用 `PartialType` 產生 UpdateDto 時一律寫 `PartialType(CreateDto, { skipNullProperties: false })`：預設會對每個欄位套 `@IsOptional()`，`{ amount: null }` 會通過驗證、到 service 才變成 500。可為 null 的欄位在子類別另外加 `@IsOptional()`。
  - 全域 ValidationPipe 在 INF-4（W2）才加入，在那之前 DTO 先用單元測試的 `validate()` 驗證；service 的業務驗證錯誤先丟 `new BadRequestException({ code, message })`。
- **e2e**：一律用 `test/utils/create-test-app.ts` 的 `createTestApp()` 建 app，它和正式環境走同一個 `configureApp`。
- **新增必填環境變數**：同一個 PR 要一起更新 `src/config/env.validation.ts`、`.env.example`、`.env.test.example` 與 CI 的 env。

## Windows 注意事項

repo 用 `.gitattributes` 統一 LF。在它加入之前就 checkout 的檔案，工作目錄裡可能還是 CRLF，可以用下面的指令檢查，有列出檔案就重新 checkout：

```bash
git ls-files --eol | grep w/crlf
```
