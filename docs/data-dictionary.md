# 資料字典 Data Dictionary

- **負責人：** D
- **依據：** PRD v0.5.8 第十四節、`backend/prisma/schema.prisma`
- **規則：** 改 schema 時要同時更新這份文件；schema 變更都要經過 D 審查。

## 共通規則

| 項目 | 規則 |
|---|---|
| 命名 | 資料庫用 snake_case（`password_hash`）；程式與 API 用 camelCase（`passwordHash`），由 Prisma `@map` 對應 |
| `id` | uuid，由資料庫 `gen_random_uuid()` 產生 |
| 金額 | `numeric(14,2)`（Prisma `Decimal`），不用浮點數；API 以字串傳遞，例如 `"1234.00"` |
| 日期 | `date`，格式 `YYYY-MM-DD` |
| 時間戳 | `timestamptz`（UTC），API 用 ISO 8601 |
| `created_at` | 新增時自動填入 |
| `updated_at` | 預設 `now()`，Prisma 每次修改時更新；**用 raw SQL UPDATE 時要自己寫 `updated_at = now()`** |
| `user_id` | 所有業務資料表都有；所有查詢都要帶入登入者 |
| 複合外鍵 | 交易的 `account_id`、`to_account_id` 和帳單的 `account_id` 用 `(帳戶 id, user_id)` 一起對應到 accounts。**資料庫會擋下「用別人的帳戶」**（Prisma 錯誤 P2003），是 service 檢查之外的最後一道防線。`onUpdate` 是 Restrict：有交易或帳單的帳戶不能改 `user_id`，不會把資料搬給別人 |
| `null` | **代表「沒有資料」，不等於 0 或空字串**。每個可為 null 的欄位都在下面寫出 null 的意思 |
| `note` 備註 | 所有表的 `note` 都一樣：選填、最多 200 字；**空字串存成 null** |
| 刪除規則 | 刪除使用者 → 他的所有資料一起刪除（Cascade）；業務資料之間不能直接刪（Restrict），例如帳戶還有交易就不能刪 |

---

## users 使用者

| 欄位 | 型別 | 可為 null | null 代表 | 說明 |
|---|---|---|---|---|
| `id` | uuid | 否 | — | 使用者 ID |
| `email` | text, unique | 否 | — | 一律轉小寫後儲存 |
| `password_hash` | text | 否 | — | bcrypt 雜湊，不存明碼 |
| `display_name` | text | 是 | 使用者沒填名字 → 畫面顯示 Email `@` 前面的部分 | 註冊時選填 |
| `created_at`、`updated_at` | timestamptz | 否 | — | |

---

## accounts 帳戶

| 欄位 | 型別 | 可為 null | null 代表 | 說明 |
|---|---|---|---|---|
| `id` | uuid | 否 | — | |
| `user_id` | uuid → users | 否 | — | |
| `name` | text | 否 | — | 1–30 字（DTO 檢查） |
| `account_type` | enum `account_type` | 否 | — | `cash` 現金、`bank` 銀行、`investment` 投資、`credit_card` 信用卡 |
| `currency` | text | 否 | — | 固定 `TWD`，不開放輸入 |
| `opening_balance` | numeric(14,2) | 否 | — | 初始餘額；只有信用卡和**估計帳戶**可以是負數（估計帳戶被扣除後，初始餘額可能變負，但目前餘額不會是負數，見 PRD 15.9） |
| `is_active` | boolean | 否 | — | 預設 `true`；有交易的帳戶只能停用不能刪 |
| `is_estimate` | boolean | 否 | — | 問卷建立的「現有資產（估計）」帳戶為 `true`；每人最多 1 個；類型一定是 `bank` |
| `deducted_from_estimate` | numeric(14,2) | 是 | 建立這個帳戶時**沒有**從估計帳戶扣錢（使用者選「否」、扣除金額為 0、信用卡等初始餘額 ≤ 0 不詢問的帳戶、估計帳戶本身）。**不存 0，一律存 null** | 有值（> 0）= 扣了多少；刪除帳戶時可加回 |
| `note` | text | 是 | 沒有備註 | 最多 200 字 |
| `created_at`、`updated_at` | timestamptz | 否 | — | |

**不存在資料表、每次即時計算的欄位（API 會回傳）：** `currentBalance`（目前餘額）、`hasTransactions`（是否有交易）

---

## categories 分類

| 欄位 | 型別 | 可為 null | null 代表 | 說明 |
|---|---|---|---|---|
| `id` | uuid | 否 | — | |
| `user_id` | uuid → users | 是 | **系統分類**，所有人共用 | P0 只有系統分類；有值 = 使用者自訂（P1 以後） |
| `code` | text, unique | 否 | — | seed 用它新增或更新；**前端用它顯示圖示**。P1 開放自訂分類時，要改成 `(user_id, code)` 不重複 |
| `name` | text | 否 | — | 顯示名稱 |
| `type` | enum `category_type` | 否 | — | `income` 收入、`expense` 支出 |
| `sort_order` | int | 否 | — | 下拉選單順序；「其他」排最後 |
| `is_active` | boolean | 否 | — | 預設 `true` |

### 系統分類（seed 會建立，code 與前端 `labels.ts` 一致）

| type | code | name | sort_order |
|---|---|---|---|
| income | `salary` | 薪資 | 1 |
| income | `investment_income` | 投資收入 | 2 |
| income | `other_income` | 其他收入 | 99 |
| expense | `food` | 飲食 | 1 |
| expense | `transport` | 交通 | 2 |
| expense | `living` | 生活 | 3 |
| expense | `housing` | 住房 | 4 |
| expense | `loan_payment` | 貸款還款 | 5 |
| expense | `insurance` | 保險 | 6 |
| expense | `tax` | 稅費 | 7 |
| expense | `subscription` | 訂閱 | 8 |
| expense | `other_expense` | 其他 | 99 |

---

## transactions 交易

| 欄位 | 型別 | 可為 null | null 代表 | 說明 |
|---|---|---|---|---|
| `id` | uuid | 否 | — | |
| `user_id` | uuid → users | 否 | — | |
| `account_id` | uuid → accounts | 否 | — | 收入／支出的帳戶；轉帳的**轉出**帳戶 |
| `transaction_type` | enum `transaction_type` | 否 | — | `income` 收入、`expense` 支出、`transfer` 轉帳（繳卡費也是轉帳） |
| `amount` | numeric(14,2) | 否 | — | 一定 > 0；方向由類型決定 |
| `category_id` | uuid → categories | 是 | 這筆是**轉帳**（轉帳沒有分類） | 收入／支出必填，分類類型要相符 |
| `to_account_id` | uuid → accounts | 是 | 這筆**不是轉帳** | 轉帳的**轉入**帳戶，不能跟 `account_id` 相同 |
| `transaction_date` | date | 否 | — | 可以是未來日期（預先記帳）；未來的交易不算進目前餘額 |
| `note` | text | 是 | 沒有備註 | 最多 200 字 |
| `bill_id` | uuid → bills, unique | 是 | 使用者**自己記的**，不是繳帳單產生的 | 有值 = 繳帳單自動產生，不能在交易頁修改或刪除 |
| `created_at`、`updated_at` | timestamptz | 否 | — | |

**即時計算（API 會回傳）：** `isBillGenerated` = `bill_id` 不是 null

---

## loans 貸款

| 欄位 | 型別 | 可為 null | null 代表 | 說明 |
|---|---|---|---|---|
| `id` | uuid | 否 | — | |
| `user_id` | uuid → users | 否 | — | |
| `name` | text | 否 | — | 1–30 字 |
| `loan_type` | text | 否 | — | 前端選項：房貸、車貸、信貸、學貸、其他 |
| `outstanding_balance` | numeric(14,2) | 否 | — | 未償餘額，使用者手動更新；0 = 已還完 |
| `monthly_payment` | numeric(14,2) | 否 | — | 每月還款；有年利率時系統自動建議，使用者可改 |
| `payment_day` | int | 否 | — | 每月幾號繳，1–31 |
| `end_date` | date | 否 | — | 結清日 |
| `interest_rate` | numeric(6,3) | 是 | 使用者**沒填年利率** → 不自動算月付，請使用者自己填 | 0–100，例如 `3.000` = 3% |
| `status` | enum `loan_status` | 否 | — | `active` 還款中、`closed` 已結清 |
| `balance_updated_at` | timestamptz | 否 | — | 最後一次更新餘額的時間；畫面顯示「X 天前」 |
| `note` | text | 是 | 沒有備註 | 最多 200 字 |
| `created_at`、`updated_at` | timestamptz | 否 | — | |

貸款和帳單是獨立資料，P0 沒有 `loan_id`。

---

## bills 帳單

| 欄位 | 型別 | 可為 null | null 代表 | 說明 |
|---|---|---|---|---|
| `id` | uuid | 否 | — | |
| `user_id` | uuid → users | 否 | — | |
| `name` | text | 否 | — | 1–30 字 |
| `amount` | numeric(14,2) | 否 | — | **預定**金額；下一期沿用 |
| `category_id` | uuid → categories | 否 | — | 只能是支出分類 |
| `account_id` | uuid → accounts | 否 | — | 預設扣款帳戶，必須是啟用的 |
| `due_date` | date | 否 | — | 這一期的到期日 |
| `due_day` | int | 否 | — | 原本的日期（例如 31）；短月改成當月最後一天，下一期再回到 31 |
| `due_month` | int | 是 | 這張帳單**不是用「每年」重複建立的** | 年度帳單原本的月份（例如 2），閏年用。⚠️ 年度帳單「停止重複」後 `recurrence` 變 `none`，但 `due_month` **保留原值**，所以 `none` 也可能有值 |
| `series_id` | uuid | 否 | — | 第一張帳單建立時由資料庫產生；下一期沿用同一個值；同一系列最多 1 張待繳 |
| `recurrence` | enum `recurrence` | 否 | — | `none` 不重複、`monthly` 每月、`yearly` 每年 |
| `status` | enum `bill_status` | 否 | — | `pending` 待繳、`paid` 已繳 |
| `paid_amount` | numeric(14,2) | 是 | **還沒繳**（status = pending） | 實繳金額；已繳時一定有值 |
| `paid_date` | date | 是 | **還沒繳**（status = pending） | 實繳日期，不能晚於今天 |
| `note` | text | 是 | 沒有備註 | 最多 200 字 |
| `created_at`、`updated_at` | timestamptz | 否 | — | |

**逾期**不存狀態，即時計算：`status = pending` 且 `due_date` < 今天（Asia/Taipei）。

⚠️ **寫入順序（給 bills service）：** 「同一系列最多 1 張待繳」是部分唯一索引，資料庫不能延後檢查，所以：
- **繳費**：先把這張改成 `paid` → 再新增下一期 `pending`
- **取消繳費**：先刪掉下一期 `pending` → 再把這張改回 `pending`

順序反過來會違反唯一索引，回傳 500。

---

## goals 財務目標

| 欄位 | 型別 | 可為 null | null 代表 | 說明 |
|---|---|---|---|---|
| `id` | uuid | 否 | — | |
| `user_id` | uuid → users, unique | 否 | — | 一人一個目標；**有這筆資料 = 已完成問卷** |
| `name` | text | 否 | — | 預設「財富自由」 |
| `monthly_spending` | numeric(14,2) | 否 | — | 財富自由後每月想花多少，1,000–333,000 |
| `target_amount` | numeric(14,2) | 否 | — | = `monthly_spending` × 300，只由 goals service 寫入 |
| `target_date` | date | 是 | 使用者沒設目標日期（P0 不問） | P1 |
| `birth_year` | int | 是 | 使用者**還沒填出生年** → 不顯示財富自由年齡，改顯示「補上出生年」提示 | 1900–今年 |
| `est_monthly_saving` | numeric(14,2) | 是 | 使用者沒填「每月大概能存多少」 | 只有記帳不滿 3 個完整月時才用到 |
| `created_at`、`updated_at` | timestamptz | 否 | — | |

**即時計算，不存表：** 目標進度、里程碑、財富自由年齡。`fireAgeStatus` 的值照前端 `types/api.ts`：`ok`、`achieved`、`need_birth_year`、`need_saving`、`unreachable`、`over_100`。

---

## 手動加在 migration 的規則

Prisma 寫不出來，已手動加在第一份 migration（`backend/prisma/migrations/20261027034404_init/migration.sql` 最下面）。之後要改這些規則，要另外手寫一份新的 migration，並同步更新這張表：

| 資料表 | 規則 |
|---|---|
| users | CHECK：`email` 必須是小寫 |
| accounts | CHECK：`currency` 必須是 `TWD` |
| accounts | CHECK：`opening_balance` ≥ 0，**信用卡和估計帳戶除外**（要跟 C 確認估計帳戶轉換） |
| accounts | CHECK：估計帳戶（`is_estimate = true`）的類型必須是 `bank` |
| accounts | CHECK：`deducted_from_estimate` 是 null 或 > 0（**沒扣就存 null，不存 0**） |
| accounts | 部分唯一索引：每位使用者最多 1 個 `is_estimate = true` |
| transactions | CHECK：`amount` > 0 |
| transactions | CHECK：轉帳要有 `to_account_id`、沒有 `category_id`、兩個帳戶不同；收入／支出要有 `category_id`、沒有 `to_account_id` |
| loans | CHECK：`outstanding_balance` ≥ 0、`monthly_payment` > 0、`payment_day` 在 1–31、`interest_rate` 是 null 或在 0–100 |
| bills | CHECK：`paid` 時 `paid_amount`、`paid_date` 必須有值；`pending` 時必須是 null |
| bills | CHECK：`amount` > 0、`paid_amount` 是 null 或 > 0、`due_day` 在 1–31、`due_month` 是 null 或在 1–12、**`yearly` 一定要有 `due_month`**（反過來不檢查，因為停止重複後 `none` 也可能有 `due_month`） |
| bills | 部分唯一索引：同一個 `series_id` 最多 1 張 `pending` |
| goals | CHECK：`monthly_spending` 在 1,000–333,000 之間，而且是**整數** |
| goals | CHECK：`target_amount` = `monthly_spending` × 300 |

**不寫成 CHECK、留給 service 檢查：** 跟「今天」有關的規則（`paid_date` 不能晚於今天、`end_date` 早於今天時必須是 `closed`、`birth_year` 不能超過今年）。原因：資料庫的「今天」是 UTC，我們的「今天」是台北時間。

**自動測試：** `backend/test/db-constraints.e2e-spec.ts`（`npm run test:e2e -- test/db-constraints.e2e-spec.ts`）。改規則時要同步改測試。

**drift 檢查**（Prisma 會不會想刪掉手動加的部分唯一索引）：✅ 2026/10/27 檢查過，兩個都是空的。之後改到這些表的 migration，都要在 `backend/` 再跑一次：

```bash
# 1. 應該只產生「This is an empty migration.」，看完把這個資料夾刪掉
npx prisma migrate dev --create-only --name drift_check

# 2. 需要一個空的 shadow 資料庫（先建立，用完刪掉）；結果應該是「This is an empty migration.」
docker exec moneymate-db psql -U postgres -c "CREATE DATABASE shadow_check;"
SHADOW_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shadow_check npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script
docker exec moneymate-db psql -U postgres -c "DROP DATABASE shadow_check;"
```
