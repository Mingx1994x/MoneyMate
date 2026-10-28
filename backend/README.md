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

# 4. 啟動，打開 http://localhost:3001/health 應回 {"status":"ok","db":"ok"}（資料庫連不到時回 503）
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
  - DTO 驗證失敗由全域 ValidationPipe 自動轉換（見「驗證管線」）；service 自己檢查多個欄位時，用 `detail(field, code)` 組 `details`，訊息一律取自代碼表，不要手寫。

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
| `@Public()`                         | `modules/auth/index.ts`            | 不需要登入的端點（register、login、`/health`）。JWT guard 是全域的，**沒加的端點一律要帶 token**，否則回 401 `AUTH_UNAUTHENTICATED`。可加在方法或類別上                                                                                            |
| `@CurrentUser()`                    | 同上                               | 取得登入者：`findAll(@CurrentUser() user: AuthUser)`，用 `user.id` 查詢。只有 `id`（guard 不查資料庫）。實作 PR 才加，空殼不用                                                                                                                     |
| `bearer(app, userId?)`              | `test/utils/test-token.ts`         | e2e 直接簽 token：`.set('Authorization', await bearer(app))`。要查資料庫的測試，`userId` 傳資料庫裡真的有的使用者                                                                                                                                  |
| `@ApiAuth()`                        | `common/swagger/api-decorators.ts` | 需要登入：Bearer＋401。整個 controller 都要登入時加在類別上；公開與需登入的端點混在一起時，加在需要登入的方法上                                                                                                                                    |
| `@ApiErrors(...)`                   | 同上                               | 列出端點可能的錯誤代碼（`'CODE'` 或 `['ACCOUNT_NOT_FOUND', 400]`）。每個方法最多一個；沒有可能的代碼就不寫；需要登入的端點不列 401。類別上有 `@ApiAuth()`、方法又要列別的 401 代碼時，要一起列 `'AUTH_UNAUTHENTICATED'`（方法的 401 會蓋掉類別的） |
| `@ApiNotImplemented()`              | 同上                               | 空殼端點：加上 501，文件的 summary 會標「【未實作】」。實作 PR 要拿掉                                                                                                                                                                              |
| `ParseIdPipe`                       | `common/id.ts`                     | `@Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) id: string`：不是 UUID 時回該資源的 404，代碼只能是允許 404 的代碼（傳錯會編譯失敗）。另外加 `@ApiParam({ name: 'id', format: 'uuid' })`                                                          |
| `@IsId(code)`                       | 同上                               | body、query 裡的 ID（`accountId`…）：不是 UUID 時回 400 `code`；代碼只能是允許 400 的代碼（例如 `ACCOUNT_NOT_FOUND`、`CATEGORY_NOT_FOUND`）                                                                                                        |
| `@IsName()`                         | `common/validators.ts`             | 名稱：去除前後空白後 1–30 字（以 code point 計算，emoji 算 1 個字）。搭配 `@Trim()`                                                                                                                                                                |
| `@IsNote()`                         | 同上                               | 備註：最多 200 字。搭配 `@IsOptional()`、`@EmptyToNull()`                                                                                                                                                                                          |
| `@IsRate()`                         | 同上                               | 利率：0–100、最多 3 位小數的數字                                                                                                                                                                                                                   |
| `@IsBooleanQuery()`                 | 同上                               | 布林 query：只接受 `'true'`／`'false'`。不會產生 Swagger 標註，DTO 要自己寫 `@ApiPropertyOptional({ type: Boolean })`                                                                                                                              |
| `@ToNumber()`                       | 同上                               | query 的數字：只轉換純數字字串，其他值留給驗證器擋                                                                                                                                                                                                 |
| `@Trim()`、`@EmptyToNull()`         | 同上                               | 去除前後空白；空白字串轉成 `null`                                                                                                                                                                                                                  |
| `ClockService`                      | `clock/clock.service.ts`           | `today()` 取台北的今天（`YYYY-MM-DD`），`now()` 取現在的時間點。用法見「開發慣例」的「時間」                                                                                                                                                       |
| `PaginationQueryDto`、`PageMetaDto` | `common/pagination.dto.ts`         | 分頁：`XxxListQueryDto extends PaginationQueryDto`（`page` 預設 1、`pageSize` 預設 20、上限 100）；回應 `extends PageMetaDto` 再加 `items`                                                                                                         |

**不要用**：

- `@Type(() => Number)`：`''` 會變成 0、`'0x10'` 會變成 16。
- `@Type(() => Boolean)`：`'false'` 會變成 `true`。
- `@IsNumber({ maxDecimalPlaces })`：`1e-7` 會讓它丟 `TypeError`，變成 500。
- Nest 的 `ParseUUIDPipe`：回 400，不是該資源的 404。

轉換類（`@Trim`、`@EmptyToNull`、`@ToNumber`、`@IsBooleanQuery`）由全域 ValidationPipe 的 `transform: true` 套用，service 不另外處理。

## 驗證管線

`configureApp` 註冊了全域 `ValidationPipe`（`src/common/validation.ts`）：`whitelist`、`forbidNonWhitelisted`、`transform`，**不開** `enableImplicitConversion`（會把 JSON 的數字 `1234.5` 轉成字串、繞過「金額必須是字串」）。

**錯誤怎麼回**

- 驗證失敗回 400，每個出錯的欄位一筆 `details`（最多 20 筆），`field` 是屬性路徑（巢狀是 `items.1.amount`），頂層 `code` 等於 `details[0].code`。`details` 不保證是 DTO 的宣告順序，測試用 `field` 找。
- 一個欄位同時違反多個規則時，依這個順序取代碼（不看裝飾器的排列）：

| 順序 | constraint                         | 代碼                                                     |
| ---- | ---------------------------------- | -------------------------------------------------------- |
| 1    | `isId`（`@IsId(code)`）            | `@IsId` 指定的代碼，狀態 400（例如 `ACCOUNT_NOT_FOUND`） |
| 2    | `isMoney`                          | `AMOUNT_INVALID`                                         |
| 3    | `moneyPositive`                    | `AMOUNT_NOT_POSITIVE`                                    |
| 4    | `moneyNonNegative`                 | `AMOUNT_NEGATIVE`                                        |
| 5    | `isName`                           | `NAME_INVALID`                                           |
| —    | 其他（含未宣告的欄位、巢狀、日期） | `VALIDATION_FAILED`                                      |

- 缺少必填欄位也是由該欄位的驗證器報錯：金額缺少是 `AMOUNT_INVALID`，必填的 ID 沒帶是 `@IsId` 的代碼（例如「找不到這個帳戶」）。
- 驗證器的 `defaultMessage` 不會送出去，訊息一律取自代碼表。
- **端點有宣告 body／query DTO 時**，未宣告的欄位回 400 `VALIDATION_FAILED`。沒有宣告 DTO 的參數不檢查（例如 `GET /loans` 帶 `?foo=1` 照常回應），不必為此寫空的 DTO。
- 有 body 或 query DTO 的端點，`@ApiErrors` 都要列 `VALIDATION_FAILED`，再加上 DTO 用到的專屬代碼。

**DTO 與 controller 的寫法限制**

- 每個請求欄位都要有 class-validator 的裝飾器（`@IsOptional()`、`@ValidateIf()` 也算）。只有 `@ApiProperty` 或 `@Transform` 的欄位會被當成未宣告，**這個端點的每個請求都會回 400**（沒送那個欄位也一樣）。
- DTO 一定是 class，用一般的 `import`：寫成 interface、type 或用 `import type` 時，pipe 完全不驗證。
- 數字、布林參數一律放在 query DTO，**不可以寫 `@Query('n') n: number`**：它會被直接轉換、不經過驗證器（`'abc'` → `NaN`、`''` → 0、`'0x10'` → 16；布林收到 `'yes'` 是 `false`）。有 query DTO 時，所有 query 參數都寫在 DTO 裡，另外寫 `@Query('x')` 會被 whitelist 擋成 400。
- `@Body()` 一定是單一 DTO 類別；需要陣列時包成 `{ items: XDto[] }`，加 `@IsArray()`、`@ValidateNested({ each: true })`、`@Type(() => XDto)`。巢狀物件沒有 `@ValidateNested()` 與 `@Type()` 的話，裡面的欄位不會驗證。
- **body DTO 不可以寫屬性初始值**，包括 Create DTO：`PartialType` 會把初始值繼承到 PATCH DTO，PATCH 沒傳那個欄位也會帶上初始值、蓋掉原值。body 的預設值在 service 套用（Swagger 照樣標 `default`）；初始值只用在 query DTO（分頁）。

**`PATCH` 的合併**（`src/common/patch.ts`）

DTO 實例上沒傳的欄位**仍是自有屬性、值是 `undefined`**，所以：

- 不可以用 `'x' in dto`、`Object.keys(dto)` 判斷有沒有傳。
- 不可以 `{ ...current, ...dto }`：沒傳的欄位會被蓋成 `undefined`。
- 不可以 `dto.x ?? current.x`：會把「傳 `null` 清空」當成沒傳。

要拿合併後的值做檢查時，先把資料庫的列轉成 service 內部的形狀（日期、金額都是字串，mapper 要明確標回傳型別），再用 `mergePatch`：

```ts
const current: LoanState = toLoanState(row); // endDate: fromDbDate(row.endDate)…
const next = mergePatch(current, dto);
if (next.status !== 'closed' && next.endDate < today) {
  throw AppException.forField('LOAN_END_DATE_IN_PAST', 'endDate');
}
```

- 直接把 Prisma 的列傳進 `mergePatch` 會編譯失敗（`Date` 與字串）；DTO 上不是資料欄位的屬性（例如 `keepCurrent`）先拿掉再傳。
- 寫入資料庫時逐欄對應（日期用 `toDbDate`、金額用 `toMoney`），只寫 `dto.x !== undefined` 的欄位；不要把 `definedOnly(dto)` 直接當成 Prisma 的 `data`。
- 空的 `PATCH`（`{}`）合法，回 200 與目前的資料。

## 空殼慣例

**完整範例是 `src/modules/loans/`**（6 個端點、建立／修改／回應／列表／query 的 DTO），照著寫就好，這裡只列重點。

**檔案與命名**

- `src/modules/<name>/`：`<name>.module.ts`、`<name>.controller.ts`、`dto/<動作>-<name>.dto.ts`；非 Prisma 的 enum 放 `dto/<name>.enum.ts`（寫成 `as const` 物件，例如 `loan-type.enum.ts`）。模組用 `nest g module modules/<name>` 產生，會自動註冊到 `AppModule`。
- 方法名稱用 `findAll`、`findOne`、`create`、`update`、`remove`，動作型端點用 camelCase（`pay`、`stopRecurrence`）。Swagger 的 operationId 會是 `Loans_findAll` 這種形式，同一個 controller 裡方法名稱不可重複。
- 單數資源（`/goal`）沒有 `:id`、不用 `ParseIdPipe`，方法用 `findOne`、`update`；`/auth/me` 的方法叫 `me`。

**controller**

- 整個 controller 都要登入就在類別上加 `@ApiAuth()`；每個端點都要有 `@ApiOperation({ summary })`（一句繁中）、成功回應（`@ApiOkResponse`／`@ApiCreatedResponse`／`@ApiNoContentResponse`，帶 `type`）、`@ApiNotImplemented()`；有可能的錯誤代碼時加一個 `@ApiErrors(...)`。
- 實作時要遵守的行為（排序、何時回哪個錯誤…）寫在 `@ApiOperation` 的 `description`，前端在 Swagger UI 看得到。
- handler 只寫 `throw new NotImplementedException();`，**不寫 `async`**（沒有 `await` 時 lint 會擋）。回傳型別照實際要回的 DTO 宣告。
- **沒用到的參數加 `_` 前綴**（`_id`、`_dto`），否則 lint 會擋；實作時拿掉。
- **固定路徑要宣告在 `:id` 之前**（例如 `payment-preview`），否則會被 `:id` 接走。
- `:id` 用 `@Param('id', new ParseIdPipe('<資源>_NOT_FOUND'))`，加 `@ApiParam({ name: 'id', format: 'uuid' })`。
- `DELETE` 加 `@HttpCode(204)`；動作型 `POST`（`pay`、`login`…）加 `@HttpCode(200)`。

**DTO**

- 每個欄位都手寫 `@ApiProperty`／`@ApiPropertyOptional`，至少有 `description` 或 `example`；**回應 DTO 每個欄位都要有 `example`**（前端在空殼階段拿來當 mock）。驗證規則和 Swagger 標註放在同一個欄位上，兩者要一致。
- `number | null`、`string | null` 這類欄位要明確寫 `type: Number`／`type: String` 和 `nullable: true`。回應中一定會出現的欄位即使可能是 null，也用 `@ApiProperty`（required）。
- enum 一律加 `enumName`；陣列寫 `type: [XxxDto]`。
- 選填但不可為 null 的欄位用 `@ValidateIf((_, v) => v !== undefined)`；可為 null 的欄位才用 `@IsOptional()`。
- `PATCH` 的 DTO：`PartialType(CreateDto, { skipNullProperties: false })`（從 `@nestjs/swagger` 匯入），可為 null 的欄位在子類別另外加 `@IsOptional()`（見 `update-loan.dto.ts`）。
- 不分頁的列表也包一層 `{ items: [...] }`（`XxxListResponseDto`）；分頁列表用 `PageMetaDto` 加 `items`。
- 時間戳的型別是 `string`、`format: 'date-time'`；日期 `format: 'date'`；金額是字串。回應不放 `userId`。
- DTO 的單元測試用 `plainToInstance` 加 `validate()`（見 `loan-dtos.spec.ts`）。

**開空殼 PR 前自己檢查**

- [ ] `npm run start:dev` 後打開 `/api/docs`，看得到自己全部的端點，而且都標【未實作】。
- [ ] 每個端點都有 `summary`、成功回應、`@ApiNotImplemented()`；有錯誤代碼的端點都有 `@ApiErrors`。
- [ ] 新的錯誤代碼已加進 `error-codes.ts` 與 `docs/error-codes.md` 自己模組的段落（含 `details.field`）。
- [ ] 重新執行 `npm run openapi:export`，`openapi.json` 一起提交。
- [ ] `npm run lint`、`npm run typecheck`、`npm test` 通過；e2e 至少確認每個端點回 501。有 body／query DTO 的端點要送合法的值，否則全域 ValidationPipe 會先回 400（見 `test/loans.e2e-spec.ts`）。

**之後的實作 PR**

- [ ] 拿掉 `@ApiNotImplemented()`，e2e 不再出現 501。
- [ ] 拿掉參數的 `_` 前綴，加上 `@CurrentUser()`（AUTH-1 提供）。
- [ ] 每個錯誤代碼都有測試，並在 `docs/error-codes.md` 填上測試位置。

## 開發慣例（摘要）

- **ESM**：相對 import 要寫 `.js` 副檔名，例如 `import { AppModule } from './app.module.js'`。
- **新模組**：`nest g module modules/<name>`，會建在 `src/modules/<name>/`。
- **Prisma 型別**：一律從 `src/prisma/index.js` 匯入，不要直接 import `src/generated/`（lint 會擋）。
- **資料庫交易**：由 controller 直接呼叫的 service 方法開 `this.prisma.$transaction(async (tx) => …)`；跨模組的寫入方法第一個參數是 `tx: PrismaTx`，參數有 `tx` 的方法內不得再開交易。
- **關聯寫入一律用純量欄位**：`data: { userId, accountId, … }`，不用 `account: { connect: { id } }`。
- **部署環境的 `DATABASE_URL` 是 Supabase 的 transaction 模式**：同一個請求的下一個查詢可能換到另一條連線，所以**不可以**用 `SET`／`SET SESSION`、session 層級的 advisory lock（`pg_advisory_lock`）、`LISTEN`／`NOTIFY`、暫存表，也不要設定 adapter 的 `statementNameGenerator`。包在 `$transaction` 裡的查詢整段用同一條連線，互動式交易、`SELECT … FOR UPDATE`、`SET LOCAL`、`pg_advisory_xact_lock` 都可以用。本機 Docker 沒有連線池，寫錯也測不出來，code review 時檢查。
- **時間**（`src/clock/clock.service.ts`）：
  - 程序時區固定 UTC。台北的今天只能用 `ClockService.today()`；`src/` 裡不可以寫 `new Date()`、`Date()`、`Date.now`（`no-direct-date.spec.ts` 會擋；有參數的 `new Date('2026-01-01T00:00:00Z')` 可以），要現在的時間點用 `ClockService.now()`。
  - 一個請求只取一次今天：controller 直接呼叫的 service 方法開頭取 `today`，往下傳。跨模組的 service 由參數接收 `today`，不注入 `ClockService`。同一個方法要同時用時間點和今天時，寫 `const now = this.clock.now(); const today = toTaipeiDate(now);`，兩個才不會剛好跨過午夜而落在不同天。
  - **只在方法裡取 `today()`／`now()`**，不要在 constructor、`onModuleInit` 或模組最上層取（例如把本月存成欄位）：service 是單例，正式環境會一直停在啟動那天，測試也測不出來。
  - **跟今天有關的檢查寫在 service，不寫在 DTO 裝飾器**（`paidDate` 不能晚於今天、`birthYear` 不能超過今年、`endDate` 的上限…）：DTO 拿不到 `ClockService`。資料庫的 CHECK 也不寫這類規則（`docs/data-dictionary.md`）。
  - service 自己寫入的業務時間戳（例如 `balanceUpdatedAt`）用 `clock.now()`；`createdAt`、`updatedAt` 交給 Prisma。
  - 時間戳換成台北日期用 `toTaipeiDate`；`fromDbDate` 只收 `@db.Date` 欄位。Nest 以外的程式（seed）寫 `new ClockService().today()`。
  - 測試固定今天用 `test/utils/fake-clock.ts` 的 `FakeClock`：單元測試傳進建構子；e2e 用 `createTestApp({ override: (b) => b.overrideProvider(ClockService).useValue(clock) })`，同一個 app 裡可以 `clock.set(...)` 換日。`FakeClock` 的時間是凍結的，不會自己往前走：要驗證時間戳「變新」，先 `clock.set()` 到比較晚的時間再送第二個請求。不要用 `vi.useFakeTimers()`／`vi.setSystemTime()`（會連 JWT、計時器一起改到）。
  - 預設用 `FakeClock.onTaipeiDate('2026-10-28')`（台北中午）；測台北跨日用 UTC 16:00 前後的時間點，例如 `new FakeClock('2026-10-31T16:00:00Z')` 是台北 11/1。
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
  - 請求的驗證由全域 ValidationPipe 負責（見「驗證管線」）；DTO 的單元測試仍可用 `plainToInstance` 加 `validate()`。service 的業務錯誤丟 `AppException`（見「錯誤處理」）。
  - `PATCH` 合併原值用 `mergePatch`，不要直接展開 DTO（見「驗證管線」）。
- **e2e**：一律用 `test/utils/create-test-app.ts` 的 `createTestApp()` 建 app，它和正式環境走同一個 `configureApp`。需要登入的端點用 `bearer(app)` 帶 token；測試用的 controller（例如測錯誤格式）不是在測登入，就加 `@Public()`。
- **登入（AUTH-1）**：token 用 HS256、有效 24 小時、只帶 `sub`（使用者 id），金鑰是 `JWT_SECRET`。發 token 用 `TokenService.signAccessToken(user)`，只在註冊、登入（AUTH-2）呼叫。
- **新增必填環境變數**：同一個 PR 要一起更新 `src/config/env.validation.ts`、`.env.example`、`.env.test.example`、`src/openapi/export-env.constants.ts` 與 CI 的 env（`backend` job，以及 `docker` job 的 `-e`）。
  - **只在 `production` 必填、其他環境有預設值**的變數（例如 `DATABASE_SSL`、`TRUST_PROXY_HOPS`）**不可以**寫屬性初始值：`plainToInstance` 會先 `new EnvVars()`，`production` 沒設時會直接拿到初始值而通過驗證。改用 `@ValidateIf` 只在 `production` 或有設值時驗證，預設值在 `validateEnv` 最後補上。
  - 測試不同環境變數的 e2e 要**另開一個檔案**，`vi.stubEnv` 之後再動態 import `createTestApp`（`@nestjs/config` 在 import 時就存下環境變數），參考 `test/trust-proxy.e2e-spec.ts`。

## Windows 注意事項

repo 用 `.gitattributes` 統一 LF。在它加入之前就 checkout 的檔案，工作目錄裡可能還是 CRLF，可以用下面的指令檢查，有列出檔案就重新 checkout：

```bash
git ls-files --eol | grep w/crlf
```
