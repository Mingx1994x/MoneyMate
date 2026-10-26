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
- **e2e**：一律用 `test/utils/create-test-app.ts` 的 `createTestApp()` 建 app，它和正式環境走同一個 `configureApp`。
- **新增必填環境變數**：同一個 PR 要一起更新 `src/config/env.validation.ts`、`.env.example`、`.env.test.example` 與 CI 的 env。

## Windows 注意事項

repo 用 `.gitattributes` 統一 LF。在它加入之前就 checkout 的檔案，工作目錄裡可能還是 CRLF，可以用下面的指令檢查，有列出檔案就重新 checkout：

```bash
git ls-files --eol | grep w/crlf
```
