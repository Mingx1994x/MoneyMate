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

| 指令                               | 用途                                         |
| ---------------------------------- | -------------------------------------------- |
| `npm run lint`                     | oxlint（type-aware），warning 也算失敗       |
| `npm run typecheck`                | `tsc --noEmit`                               |
| `npm run format` ／ `format:check` | Prettier 格式化／檢查                        |
| `npm run build`                    | 編譯到 `dist/`                               |
| `npm run db:migrate`               | 建立並套用 migration（本機，D 負責 schema）  |
| `npm run db:deploy`                | 只套用既有 migration（部署用）               |
| `npm run openapi:export`           | 匯出 `openapi.json`（不需要資料庫與 `.env`） |

Prisma 一律透過上面的 npm scripts 執行。**不要用 `npx prisma`**（沒裝時會自動下載 `latest`，目前是 8 RC），也不要照 Prisma 的更新提示執行 `npm i prisma@latest`。

## API 文件（Swagger）

- 本機啟動後打開 `http://localhost:3001/api/docs`（JSON 在 `/api/docs-json`）。按 **Authorize** 貼上 token 就能測需要登入的端點。
- `SWAGGER_ENABLED`：選填，只接受 `true`／`false`；沒設時 `production` 關閉、其他環境開啟。**Render 上設 `true`**。
- `openapi.json` 進版控，前端用它產生型別。**改了 DTO、controller 或錯誤代碼後要重新執行 `npm run openapi:export`，把 `openapi.json` 一起提交**；CI 會重新匯出並比對，忘了就失敗。
- rebase 後 `openapi.json` 衝突時**不要手動合併**，直接重新執行 `openapi:export`。
- 後端 PR 讓前端 typecheck 失敗時：新增欄位、代碼、端點不會失敗；改名、刪除、改型別會，要先在群組通知 B，由 B 在同一個 PR 補前端的修改，或先開前端 PR。不可以為了讓 CI 通過而跳過檢查。
- 新增**必填**環境變數時，`src/openapi/export-env.constants.ts` 也要補假值（漏了 `npm test` 會失敗）。

## 錯誤處理

錯誤回應的格式與全部代碼見 repo 的 [`docs/error-codes.md`](../docs/error-codes.md)。

- **業務錯誤一律丟 `AppException`**，狀態碼與訊息從代碼表（`src/common/errors/error-codes.ts`）帶出：

  ```ts
  throw new AppException('LOAN_NOT_FOUND');
  // 跟某個欄位有關：帶 details，頂層 code 與 details[0].code 相同
  throw AppException.forField('TRANSFER_SAME_ACCOUNT', 'toAccountId');
  // 代碼允許第二個狀態碼時（alsoAllowed）：body 引用不存在的帳戶是 400，路徑上是 404
  throw AppException.forField('ACCOUNT_NOT_FOUND', 'accountId', 400);
  ```

  - 狀態碼寫錯會編譯失敗；`code` 是變數時型別擋不住，執行期會丟錯變成 500。
  - 不要丟 `BadRequestException`、`NotFoundException` 這類例外來表示業務錯誤：filter 不讀它們帶的 `code`，只會回通用的 `BAD_REQUEST`、`NOT_FOUND`。
  - 每個代碼的 `details.field` 寫在 `docs/error-codes.md`；跟欄位無關的錯誤 `details` 是 `[]`。
  - 多個欄位的錯誤（INF-4）用 `detail(field, code)` 組 `details`，訊息一律取自代碼表，不要手寫。

- **500 不會回傳錯誤訊息**，只寫日誌；Prisma 的錯誤只記名稱、代碼與約束名稱（message 可能含使用者輸入）。
- **檢查資料是不是登入者的**：用 `findFirst({ where: { id, userId } })`，找不到就丟該資源的 `*_NOT_FOUND`；或用 `updateMany`／`deleteMany` 帶 `userId` 再檢查 `count`。不要靠 `update` 找不到時的 P2025（只能轉成通用的 `NOT_FOUND`）。
- **新增錯誤代碼**，同一個 PR 要一起改：
  1. `ERROR_CODES` 自己模組的段落（段內照字母排序）。
  2. `docs/error-codes.md` 的同一段落（含 `details.field`）；`error-codes.spec.ts` 會檢查兩邊一致。
  3. 端點的 `@ApiErrors(...)`。
  4. 重新執行 `openapi:export`。
  5. 實作 PR 補測試，並填 md 的「測試位置」。
- 前端遇到不認得的代碼時直接顯示 `message`。`/api/v1` 以外的路徑（回 Express 的 HTML 404）與 `/health` 的 503 不是這個格式。

## 共用工具

| 工具                                | 位置                               | 用法                                                                                                                                                                                                                                               |
| ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ApiAuth()`                        | `common/swagger/api-decorators.ts` | 需要登入：Bearer＋401。整個 controller 都要登入時加在類別上；公開與需登入的端點混在一起時，加在需要登入的方法上                                                                                                                                    |
| `@ApiErrors(...)`                   | 同上                               | 列出端點可能的錯誤代碼（`'CODE'` 或 `['ACCOUNT_NOT_FOUND', 400]`）。每個方法最多一個；沒有可能的代碼就不寫；需要登入的端點不列 401。類別上有 `@ApiAuth()`、方法又要列別的 401 代碼時，要一起列 `'AUTH_UNAUTHENTICATED'`（方法的 401 會蓋掉類別的） |
| `@ApiNotImplemented()`              | 同上                               | 空殼端點：加上 501，文件的 summary 會標「【未實作】」。實作 PR 要拿掉                                                                                                                                                                              |
| `ParseIdPipe`                       | `common/id.ts`                     | `@Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) id: string`：不是 UUID 時回該資源的 404，代碼只能是允許 404 的代碼（傳錯會編譯失敗）。另外加 `@ApiParam({ name: 'id', format: 'uuid' })`                                                          |
| `@IsId(code)`                       | 同上                               | body、query 裡的 ID（`accountId`…）：不是 UUID 時失敗，INF-4 會轉成 400 `code`；代碼只能是允許 400 的代碼（例如 `ACCOUNT_NOT_FOUND`、`CATEGORY_NOT_FOUND`）                                                                                        |
| `@IsName()`                         | `common/validators.ts`             | 名稱：去除前後空白後 1–30 字（以 code point 計算，emoji 算 1 個字）。搭配 `@Trim()`                                                                                                                                                                |
| `@IsNote()`                         | 同上                               | 備註：最多 200 字。搭配 `@IsOptional()`、`@EmptyToNull()`                                                                                                                                                                                          |
| `@IsRate()`                         | 同上                               | 利率：0–100、最多 3 位小數的數字                                                                                                                                                                                                                   |
| `@IsBooleanQuery()`                 | 同上                               | 布林 query：只接受 `'true'`／`'false'`。不會產生 Swagger 標註，DTO 要自己寫 `@ApiPropertyOptional({ type: Boolean })`                                                                                                                              |
| `@ToNumber()`                       | 同上                               | query 的數字：只轉換純數字字串，其他值留給驗證器擋                                                                                                                                                                                                 |
| `@Trim()`、`@EmptyToNull()`         | 同上                               | 去除前後空白；空白字串轉成 `null`                                                                                                                                                                                                                  |
| `PaginationQueryDto`、`PageMetaDto` | `common/pagination.dto.ts`         | 分頁：`XxxListQueryDto extends PaginationQueryDto`（`page` 預設 1、`pageSize` 預設 20、上限 100）；回應 `extends PageMetaDto` 再加 `items`                                                                                                         |

**不要用**：

- `@Type(() => Number)`：`''` 會變成 0、`'0x10'` 會變成 16。
- `@Type(() => Boolean)`：`'false'` 會變成 `true`。
- `@IsNumber({ maxDecimalPlaces })`：`1e-7` 會讓它丟 `TypeError`，變成 500。
- Nest 的 `ParseUUIDPipe`：回 400，不是該資源的 404。

轉換類（`@Trim`、`@EmptyToNull`、`@ToNumber`、`@IsBooleanQuery`）要等 INF-4 的全域 ValidationPipe（`transform: true`）才會在請求中生效；DTO 現在就掛上，service 不另外處理。

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
  - 全域 ValidationPipe 在 INF-4（W2）才加入，在那之前 DTO 先用單元測試的 `plainToInstance` 加 `validate()` 驗證；service 的業務錯誤丟 `AppException`（見「錯誤處理」）。
- **e2e**：一律用 `test/utils/create-test-app.ts` 的 `createTestApp()` 建 app，它和正式環境走同一個 `configureApp`。
- **新增必填環境變數**：同一個 PR 要一起更新 `src/config/env.validation.ts`、`.env.example`、`.env.test.example`、`src/openapi/export-env.constants.ts` 與 CI 的 env（`backend` job，以及 `docker` job 的 `-e`）。

## Windows 注意事項

repo 用 `.gitattributes` 統一 LF。在它加入之前就 checkout 的檔案，工作目錄裡可能還是 CRLF，可以用下面的指令檢查，有列出檔案就重新 checkout：

```bash
git ls-files --eol | grep w/crlf
```
