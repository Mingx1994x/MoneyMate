# 錯誤代碼表

所有錯誤回應的格式（PRD 第十三節）：

```json
{
  "statusCode": 400,
  "code": "LOAN_END_DATE_IN_PAST",
  "message": "結清日已經過了，請修改結清日，或把狀態設為已結清",
  "details": [
    {
      "field": "endDate",
      "code": "LOAN_END_DATE_IN_PAST",
      "message": "結清日已經過了，請修改結清日，或把狀態設為已結清"
    }
  ],
  "requestId": "3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10"
}
```

- **前端只用 `code` 判斷**；遇到不認得的代碼時，直接顯示 `message`。
- `details`：跟欄位有關的錯誤才有內容，`field` 是請求中的屬性路徑（與送出的 camelCase 名稱相同）；頂層 `code` 等於 `details[0].code`。跟欄位無關的錯誤是 `[]`。
- HTTP 寫兩個的代碼（例如 `404／400`）：400 那種一定帶 `details`，404 那種是 `[]`，前端依 `details` 是否為空來區分。
- 429 另外帶 `retryAfterSeconds`（幾秒後可以再試）。
- `/api/v1` 以外的路徑、`/health` 的 503、部署平台回的 502／503／504 不保證是這個格式。

**維護方式**：程式裡的來源是 `backend/src/common/errors/error-codes.ts`，這份文件要和它一致（代碼、HTTP、訊息），`error-codes.spec.ts` 會檢查。新增代碼時兩邊一起改，加在自己模組的段落，段內照字母排序。「提議」表示 PRD 沒有命名，負責人可以在自己的空殼 PR 改名。

## 共用（E）

| 代碼                     | HTTP | 訊息                             | 何時發生                                                                   | details.field | 測試位置                                                                                               |
| ------------------------ | ---- | -------------------------------- | -------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `AUTH_UNAUTHENTICATED`   | 401  | 請先登入                         | 沒帶 token、token 無效或過期；沒指定代碼的 401                             | `[]`          | `all-exceptions.filter.spec.ts`                                                                        |
| `BAD_REQUEST`            | 400  | 請求格式不正確                   | JSON 解析失敗、body-parser 的 400；沒指定代碼的 400                        | `[]`          | `test/errors.e2e-spec.ts`                                                                              |
| `CONFLICT`               | 409  | 資料狀態已變更，請重新整理後再試 | 沒指定代碼的 409                                                           | `[]`          | `all-exceptions.filter.spec.ts`                                                                        |
| `FORBIDDEN`              | 403  | 沒有權限執行這個操作             | guard 回 `false` 時 Nest 丟的 `ForbiddenException`                         | `[]`          | `all-exceptions.filter.spec.ts`                                                                        |
| `INTERNAL_ERROR`         | 500  | 系統發生錯誤，請稍後再試         | 所有未預期的例外                                                           | `[]`          | `all-exceptions.filter.spec.ts`                                                                        |
| `NOT_FOUND`              | 404  | 找不到要求的資源                 | `/api/v1` 底下的未知路由；沒指定代碼的 404                                 | `[]`          | `test/errors.e2e-spec.ts`                                                                              |
| `NOT_IMPLEMENTED`        | 501  | 這個功能還在開發中               | 空殼                                                                       | `[]`          | `test/errors.e2e-spec.ts`                                                                              |
| `PAYLOAD_TOO_LARGE`      | 413  | 送出的資料太大                   | body 超過上限                                                              | `[]`          | `test/errors.e2e-spec.ts`                                                                              |
| `TOO_MANY_REQUESTS`      | 429  | 操作太頻繁，請稍後再試           | 限流（註冊、登入的次數限制，PRD FR-03）                                    | `[]`          | `all-exceptions.filter.spec.ts`、`test/auth-ip-limit.e2e-spec.ts`、`test/auth-email-limit.e2e-spec.ts` |
| `UNSUPPORTED_MEDIA_TYPE` | 415  | 不支援的資料格式                 | body-parser 的 415（例如 charset 不是 UTF-8、不支援的 `Content-Encoding`） | `[]`          | `test/errors.e2e-spec.ts`                                                                              |
| `VALIDATION_FAILED`      | 400  | 輸入的資料有誤，請檢查標示的欄位 | DTO 驗證失敗，而且欄位沒有專屬代碼（INF-4）；service 檢查的一般欄位錯誤    | 出錯的欄位    | `validation.spec.ts`、`test/validation.e2e-spec.ts`                                                    |

## 共用驗證（INF-4）

| 代碼                  | HTTP | 訊息                  | 何時發生                   | details.field | 測試位置                                            |
| --------------------- | ---- | --------------------- | -------------------------- | ------------- | --------------------------------------------------- |
| `AMOUNT_INVALID`      | 400  | 金額格式不正確        | `@IsMoney` 的 `isMoney`    | 金額欄位      | `validation.spec.ts`、`test/validation.e2e-spec.ts` |
| `AMOUNT_NEGATIVE`     | 400  | 金額不可為負數        | `moneyNonNegative`（提議） | 金額欄位      | `validation.spec.ts`                                |
| `AMOUNT_NOT_POSITIVE` | 400  | 金額必須大於 0        | `moneyPositive`            | 金額欄位      | `validation.spec.ts`、`test/validation.e2e-spec.ts` |
| `AMOUNT_OVERFLOW`     | 400  | 金額超出可記錄的範圍  | 寫入時資料庫數值溢位（PostgreSQL 22003、Prisma P2020）。金額超過 `numeric(14,2)` 是其中一種；利率、整數溢位也會看到這句 | `[]`          | `database-exception.spec.ts`、`all-exceptions.filter.spec.ts`、`test/db-errors.e2e-spec.ts` |
| `NAME_INVALID`        | 400  | 名稱需為 1 到 30 個字 | `@IsName` 的 `isName`      | `name`        | `validation.spec.ts`、`test/validation.e2e-spec.ts` |

## auth（D）

| 代碼                       | HTTP | 訊息                    | 何時發生                                            | details.field            | 測試位置                     |
| -------------------------- | ---- | ----------------------- | --------------------------------------------------- | ------------------------ | ---------------------------- |
| `AUTH_EMAIL_TAKEN`         | 409  | 這個 Email 已經註冊過了 | 註冊時 Email 重複（轉成小寫後比對，大小寫不同也算） | `email`                  | `test/auth-flow.e2e-spec.ts` |
| `AUTH_INVALID_CREDENTIALS` | 401  | Email 或密碼錯誤        | 登入失敗：Email 不存在或密碼錯誤，兩者回應完全相同  | `[]`（不指出是哪一個錯） | `test/auth-flow.e2e-spec.ts` |

## onboarding（D）

| 代碼                      | HTTP | 訊息           | 何時發生                                             | details.field | 測試位置 |
| ------------------------- | ---- | -------------- | ---------------------------------------------------- | ------------- | -------- |
| `ONBOARDING_ALREADY_DONE` | 409  | 已經完成問卷了 | 問卷重送；第二個估計帳戶（含把既有帳戶改成估計） | `[]`          | `database-exception.spec.ts`、`test/db-errors.e2e-spec.ts` |
| `ONBOARDING_REQUIRED`     | 409  | 請先完成問卷   | 還沒完成問卷就呼叫 `/goal`、`/goal/progress`（提議） | `[]`          | —        |

## accounts（C）

| 代碼                         | HTTP     | 訊息                                           | 何時發生                                                                   | details.field                                                | 測試位置                    |
| ---------------------------- | -------- | ---------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------- |
| `ACCOUNT_DEACTIVATE_BLOCKED` | 409      | 帳戶還有餘額或未來的交易，不能停用             | 停用條件不符（提議）                                                       | `isActive`                                                   | —                           |
| `ACCOUNT_IN_USE`             | 409      | 這個帳戶已有交易或帳單，不能刪除，可以改成停用 | 刪除有交易或被帳單使用的帳戶                                               | `[]`                                                         | —                           |
| `ACCOUNT_INACTIVE`           | 409      | 這個帳戶已停用，請先重新啟用                   | 對停用帳戶新增、修改、刪除交易；用停用帳戶繳費；修改停用帳戶（含初始餘額） | 寫入時是對應的帳戶欄位；DELETE 時是 `[]`                     | —                           |
| `ACCOUNT_NOT_FOUND`          | 404／400 | 找不到這個帳戶                                 | 路徑上是 404；body、query 引用不存在或他人的帳戶是 400                     | 404：`[]`；400：引用的 ID 欄位（`accountId`、`toAccountId`） | `test/accounts.e2e-spec.ts` |
| `OPENING_BALANCE_NEGATIVE`   | 400      | 非信用卡帳戶的初始餘額不可為負數               |                                                                            | `openingBalance`                                             | `test/accounts.e2e-spec.ts` |

## categories（C）

| 代碼                     | HTTP | 訊息           | 何時發生                                       | details.field | 測試位置 |
| ------------------------ | ---- | -------------- | ---------------------------------------------- | ------------- | -------- |
| `CATEGORY_NOT_FOUND`     | 400  | 找不到這個分類 | body、query 引用不存在的分類（系統分類算存在） | `categoryId`  | —        |
| `CATEGORY_TYPE_MISMATCH` | 400  | 分類的類型不符 | 收入交易選了支出分類、帳單選了收入分類（提議） | `categoryId`  | —        |

## transactions（C）

| 代碼                          | HTTP | 訊息                             | 何時發生                                                           | details.field | 測試位置 |
| ----------------------------- | ---- | -------------------------------- | ------------------------------------------------------------------ | ------------- | -------- |
| `BILL_LINKED_TRANSACTION`     | 409  | 這筆交易由帳單產生，請到帳單修改 | 修改或刪除帳單產生的交易                                           | `[]`          | —        |
| `TRANSACTION_FIELDS_MISMATCH` | 400  | 這種交易類型不能帶這個欄位       | 轉帳帶了分類、收入或支出帶了轉入帳戶；缺少該類型必填的欄位（提議） | 不符合的欄位  | —        |
| `TRANSACTION_NOT_FOUND`       | 404  | 找不到這筆交易                   |                                                                    | `[]`          | —        |
| `TRANSFER_SAME_ACCOUNT`       | 400  | 不能轉帳給同一個帳戶             |                                                                    | `toAccountId` | —        |

## bills（E）

| 代碼                     | HTTP | 訊息                               | 何時發生                           | details.field | 測試位置 |
| ------------------------ | ---- | ---------------------------------- | ---------------------------------- | ------------- | -------- |
| `BILL_ALREADY_PAID`      | 409  | 這張帳單已經繳過了                 | 重複繳費、修改已繳帳單的金額或日期；同一張帳單的第二筆交易 | `[]`          | `database-exception.spec.ts` |
| `BILL_NOT_FOUND`         | 404  | 找不到這張帳單                     |                                    | `[]`          | —        |
| `NEXT_BILL_ALREADY_PAID` | 409  | 下一期帳單已經繳費，不能取消這一期 |                                    | `[]`          | —        |
| `PAID_DATE_IN_FUTURE`    | 400  | 繳費日期不可晚於今天               |                                    | `paidDate`    | —        |

## loans（E）

| 代碼                            | HTTP | 訊息                                             | 何時發生                                                                                                                      | details.field    | 測試位置 |
| ------------------------------- | ---- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- |
| `LOAN_END_DATE_IN_PAST`         | 400  | 結清日已經過了，請修改結清日，或把狀態設為已結清 | 新增或修改（合併後）時 `endDate` 早於台北今天，但 `status` 不是 `closed`；包含把 `closed` 改回 `active` 但結清日沒改（提議）  | `endDate`        | —        |
| `LOAN_MONTHLY_PAYMENT_REQUIRED` | 400  | 沒有填年利率時，請自己填每月還款                 | 新增時沒帶 `monthlyPayment`，而且 `interestRate` 沒帶或為 `null`，或 `outstandingBalance` 是 0（算不出大於 0 的月付）（提議） | `monthlyPayment` | —        |
| `LOAN_NOT_FOUND`                | 404  | 找不到這筆貸款                                   | 路徑的 `:id` 不存在、屬於他人或不是 UUID                                                                                      | `[]`             | LOAN-1   |
