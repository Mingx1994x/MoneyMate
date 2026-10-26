# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

Money Mate：5 人小組課程專案的個人財務網站（記帳、帳戶、貸款、帳單、財富自由目標）。需求以 `docs/PRD-v0.5.10-完整版.md` 為準，角色代號 A–E 的分工見 PRD 第二十節。

- `backend/`：NestJS 12（ESM）＋ Prisma 7 ＋ PostgreSQL 16。
- `frontend/`：Nuxt，尚未建立。
- `docs/`：PRD、`decisions.md`（決定紀錄）、`data-dictionary.md`（資料表欄位說明，D 負責）、`error-codes.md`（錯誤代碼表）。

文件、程式註解、Swagger 說明與錯誤訊息都用繁體中文。後端的完整慣例（錯誤處理、共用工具、空殼寫法、金額與日期規則）寫在 `backend/README.md`，修改後端前先讀。

## 常用指令

資料庫在 repo 根目錄啟動：`docker compose up -d`（建立 `app_dev` 與 `app_test`）。其餘在 `backend/` 執行，需要 Node 24.15 以上、未滿 25。

```bash
npm ci                                          # postinstall 會產生 Prisma client
npm run start:dev                               # http://localhost:3001，Swagger 在 /api/docs
npm run lint                                    # oxlint（type-aware），warning 也算失敗
npm run format:check
npm run typecheck
npm test                                        # 單元測試（src/**/*.spec.ts）
npm test -- src/common/money.spec.ts            # 只跑一個檔案
npm test -- src/common/money.spec.ts -t '名稱'  # 只跑名稱符合的測試
npm run test:e2e                                # e2e（test/**/*.e2e-spec.ts），需要 .env.test 與本機資料庫
npm run test:e2e -- test/loans.e2e-spec.ts
npm run openapi:export                          # 改了 DTO、controller、錯誤代碼後必跑
```

- Prisma 一律透過 npm scripts（`db:migrate`、`db:deploy`、`prisma:generate`），不要用 `npx prisma`（會下載最新版）。
- `.env.test` 必須指向 `*_test` 資料庫；`db:test:prepare` 與 `createTestApp()` 都會檢查，不是就直接失敗。

## 架構重點

- **全域設定只放在 `configureApp()`**（`src/app.setup.ts`）：前綴 `/api/v1`（`/health` 除外）、CORS、安全標頭、trust proxy、全域 filter，之後的 ValidationPipe 與日誌也放這裡。`main.ts`、e2e 的 `createTestApp()`（`test/utils/create-test-app.ts`）、`openapi:export` 都共用它，e2e 一律用 `createTestApp()` 建 app。
- **時區**：程序時區固定 UTC，`src/tz.ts` 必須是進入點的第一個 import。台北的「今天」之後由 `ClockService` 提供，不要自己用 `new Date()` 算日期。
- **Prisma**：client 產生在 `src/generated/`（不進版控），業務程式只能從 `src/prisma/index.js` 匯入（oxlint 會擋）。`PrismaService` 不在啟動時連線，所以資料庫斷線時 app 仍能啟動、`/health` 回 503，`openapi:export` 也不需要資料庫。Prisma 7 不會自動讀 `.env`，migrate 用的是 `prisma.config.ts` 裡的 `DIRECT_URL`。
- **資料庫交易**：由 controller 直接呼叫的 service 方法開 `$transaction`；跨模組的寫入方法第一個參數是 `tx: PrismaTx`，方法內不得再開交易。部署環境的 `DATABASE_URL` 是 Supabase 的 transaction 模式連線池，不能用 session 層級的功能（`SET`、advisory lock、`LISTEN` 等），本機測不出來。
- **錯誤**：業務錯誤一律丟 `AppException('<CODE>')`，`src/common/errors/error-codes.ts` 是代碼的唯一來源，必須和 `docs/error-codes.md` 同步（`error-codes.spec.ts` 會檢查）。`AllExceptionsFilter` 把所有例外轉成統一的錯誤格式。
- **`openapi.json` 進版控**：前端型別從它產生，CI 會重新匯出並比對。衝突時不要手動合併，重新執行 `openapi:export`。
- **模組**放在 `src/modules/<name>/`；`src/modules/loans/` 是端點空殼的範例（未實作的端點回 501）。
- **資料表**：所有業務資料表都有 `user_id`，查詢一律帶入登入者。Prisma 寫不出來的 CHECK 與部分唯一索引要在 migration SQL 手動加，清單在 `docs/data-dictionary.md`。
- **ESM**：相對 import 要寫 `.js` 副檔名。測試用 Vitest（`globals: true`，mock 用 `vi`）。

## 協作規則

- 從 `dev` 開功能分支，PR 目標是 `dev`；CI 只在 PR 上跑。
- Commit 格式：`<gitmoji> <type>: <中文標題>`，例如 `✨ feat: LOAN-1 貸款端點空殼`、`📝 docs: 更新 PRD 至 v0.5.10`。
- Commit 訊息、PR 標題與 PR 說明都以繁體中文為主；gitmoji、type 與程式名稱（端點、檔名、套件名）維持原文。
- PR 標題結尾標上組別代號，例如 `(E)`。前端 PR 由 A 審、後端 PR 由 E 審，A、E 互審；schema 變更另需 D 審查（`docs/decisions.md` D-007）。
- 重要決定寫進 `docs/decisions.md`。
