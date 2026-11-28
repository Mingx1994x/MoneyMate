# 自訂分類 SPEC（P1，草案）

依據：PRD 15.13、US-22、FR-29。這份把前端、後端、資料庫要對齊的地方寫在一起，確認後再開始做。

狀態：**草案**，「待確認」那一節討論完再改成定案。

分工（暫定）：資料庫與 migration 由 D（Shin）審，後端由 Jason 做，前端「分類管理頁」待定（B 或 Jason），表單的小修改跟著後端 PR 一起做（見第五節）。

---

## 一、規則

| # | 規則 | 誰擋 |
|---|---|---|
| R1 | 系統分類（`user_id` 是 null）所有人共用，**不能改名、停用、刪除** | service |
| R2 | 自訂分類只有建立的人看得到、用得到、改得到 | service（查詢一律帶 `userId`） |
| R3 | 自訂分類**沒有 `code`**；系統分類一定有 `code` | DB CHECK |
| R4 | 名稱去除前後空白後 1–30 字（和帳戶名稱一樣用 `@Trim()`） | DTO |
| R5 | 建立時選類型（`income`／`expense`），**建立後不能改類型** | DTO（PATCH 不收 `type`） |
| R6 | 同一個人、同一個類型，**啟用中**的分類不能同名，也不能和同類型的系統分類同名 | DB（自己的）＋ service（系統的） |
| R7 | 停用的分類不算重名；重新啟用時如果撞名，回 409 `CATEGORY_NAME_TAKEN`，要先改名 | DB ＋ service |
| R8 | 被交易或帳單用過的分類**不能刪除，只能停用** | service ＋ DB 外鍵（`onDelete: Restrict`） |
| R9 | 停用後：不出現在記帳、帳單的選單；歷史交易照樣顯示名稱；已經用它的帳單照常繳費、照常產生下一期 | 現有程式已經是這樣（`bills.service.ts` Q17） |
| R10 | 名稱比對是字面比對（「Food」和「food」算不同） | — |
| R11 | 每個人每種類型最多 **10 個啟用中**的自訂分類（支出 10、收入 10）。停用的不算，不然用過的分類刪不掉、只能停用，會永遠卡在上限 | service |
| R12 | 自訂分類不能調整順序，依名稱排（第三節） | — |
| R13 | 系統分類（包括「其他」）使用者不能隱藏 | — |

---

## 二、資料庫（D 審）

`categories` 不加新欄位，只改約束。

先改 `schema.prisma`（`code String?`、拿掉 `@unique`），照 `backend/README.md` 的流程跑 `npm run db:migrate` 產生 migration（注意：它會直接套用到本機資料庫，手動加完 SQL 後要重設本機資料庫再套用一次，或先和 D 確認怎麼做）。Prisma 會自己產生下面兩句，**不要再手寫一次**（重複 `DROP INDEX` 會讓 migration 失敗）：

```sql
ALTER TABLE "categories" ALTER COLUMN "code" DROP NOT NULL;
DROP INDEX "categories_code_key";
```

再把下面 3 條手動加在同一份 migration 的最後面：

```sql
-- 2. 系統分類的 code 唯一（自訂分類的 code 都是 null，不受影響）
CREATE UNIQUE INDEX categories_system_code_key
  ON categories (code) WHERE user_id IS NULL;

-- 3. 系統分類一定有 code，自訂分類一定沒有（R3）
ALTER TABLE categories ADD CONSTRAINT categories_code_only_system
  CHECK ((user_id IS NULL) = (code IS NOT NULL));

-- 4. 自己啟用中的分類不能同名（R6、R7）
CREATE UNIQUE INDEX categories_user_active_name_key
  ON categories (user_id, type, name) WHERE user_id IS NOT NULL AND is_active;
```

連帶要改的地方：

- `schema.prisma`：`code String?`，拿掉 `@unique`；228 行舊的 P1 註解改掉。
- `seed/system-categories.ts`：`ON CONFLICT (code) WHERE user_id IS NULL DO UPDATE …`。使用者的分類不會再有 `code`，77–85 行「code 已經是使用者的分類」的檢查不會再發生，刪掉，52–53 行註解一起改。
- `docs/data-dictionary.md`：categories 段的 `code` 改成 nullable，「手動加在 migration 的規則」加上面 3 條，並照那一節重跑 drift 檢查（確認 Prisma 不會想刪掉手動加的部分唯一索引）。

---

## 三、API

全部要登入，路徑前綴 `/api/v1`。

### 回應格式（所有端點共用）

```jsonc
{
  "id": "uuid",
  "code": "food",        // 自訂分類是 null；code 是 null ＝ 自訂分類（R3 保證）
  "name": "飲食",
  "type": "expense",
  "sortOrder": 1,
  "isActive": true       // 新增欄位
}
```

不加 `isCustom`、`icon`：`code === null` 就是自訂分類；icon 由前端決定（第四節）。

`CategoryResponseDto` 要改：

- `code`：`@ApiProperty({ type: String, nullable: true, … })`，說明從「系統分類代碼，唯一，seed 用它 upsert」改成「系統分類代碼；自訂分類是 null」。**沒加 `nullable: true` 的話，`openapi.json` 還是 `string`，前端型別檢查抓不到 null。**
- 新增 `isActive`。
- 改完跑 `npm run openapi:export`。

### `GET /categories`（修改）

| 參數 | 說明 |
|---|---|
| `type` | 不變，`income`／`expense` |
| `includeInactive` | **新增**，`true` 時一併回停用的分類（寫法照 `GET /accounts`）。預設只回啟用的 |

- 回傳系統分類＋自己的分類。
- 排序：`type` → `sortOrder` → `name` → `id`。
- 自訂分類的 `sortOrder` 由後端固定寫 50：排在系統分類後面、「其他」（99）前面，自訂分類之間依名稱排序。
- 注意：中文名稱是依資料庫的字元碼排序，**不是筆畫或注音**。P1 先接受；要照建立順序排，要另外加 `created_at` 欄位（見第八節）。

### `POST /categories`（新增）

```jsonc
{ "name": "寵物", "type": "expense" }
```

- 201，回傳分類。`userId` 是登入者，`code` 是 null，`sortOrder` 是 50，`isActive` 是 true。
- 錯誤：400 `VALIDATION_FAILED`（名稱長度、type 不對）；409 `CATEGORY_NAME_TAKEN`（R6）；409 `CATEGORY_LIMIT_REACHED`（R11，同類型啟用中已經 10 個）。
- R11 在同一個資料庫交易裡先數再寫。兩個請求同時送出時可能變成 11 個，P1 接受（只是選單多一個，不會壞資料）。

### `PATCH /categories/:id`（新增）

```jsonc
{ "name": "毛小孩", "isActive": false }   // 兩個欄位都可省略
```

- 只收 `name`、`isActive`；帶 `type` 會被全域 ValidationPipe 擋下（400 `VALIDATION_FAILED`），所以 R5 不用另外寫。
- 200，回傳分類。
- 錯誤：
  - 404 `CATEGORY_NOT_FOUND`：`:id` 不存在、是別人的，或是**系統分類**（R1，系統分類對這支端點來說就是找不到可以改的）。
  - 409 `CATEGORY_NAME_TAKEN`：改名撞名，或重新啟用時撞名（R7）。
  - 409 `CATEGORY_LIMIT_REACHED`：重新啟用時，同類型啟用中已經 10 個（R11）。

### `DELETE /categories/:id`（新增）

- 204。
- 錯誤：
  - 404 `CATEGORY_NOT_FOUND`：同 PATCH。
  - 409 `CATEGORY_IN_USE`：有交易或帳單用到它（R8）。service 先查；同時有人記帳的情況由外鍵擋下。撞到的外鍵是 `transactions_category_id_fkey`、`bills_category_id_fkey`，由 `categories.remove` **自己接**，轉成 `CATEGORY_IN_USE`（寫法照 `ACCOUNT_IN_USE_FKEYS`）。不要放進 `DB_CONSTRAINT_CODES`（`db-constraint-codes.ts` 開頭寫了：刪除和寫入意思不同的外鍵不放）。

### 錯誤代碼（`error-codes.ts` 與 `docs/error-codes.md` 一起改）

| 代碼 | 狀態 | 訊息 | 什麼時候 | details |
|---|---|---|---|---|
| `CATEGORY_NOT_FOUND` | 400／**404** | 找不到這個分類 | body、query 引用是 400（不變）；路徑上是 404（新增） | 400：`categoryId`；404：`[]` |
| `CATEGORY_NAME_TAKEN` | 409 | 已經有同名的分類 | R6、R7 | `name` |
| `CATEGORY_IN_USE` | 409 | 這個分類已有交易或帳單，不能刪除，可以改成停用 | R8 | `[]` |
| `CATEGORY_LIMIT_REACHED` | 409 | 自訂分類已達上限（每種類型 10 個） | R11 | `[]` |

`CATEGORY_NOT_FOUND` 在 `error-codes.ts` 寫成 `{ status: 400, alsoAllowed: [404] }`，**預設維持 400**，PATCH、DELETE 的路徑明確傳 404。不要照 `ACCOUNT_NOT_FOUND` 把預設改成 404：`categories.service.ts:54`、`transactions.service.ts:72` 沒帶狀態，預設一改就會從 400 悄悄變成 404。

`categories_user_active_name_key` 要加進 `DB_CONSTRAINT_CODES` 對應到 `CATEGORY_NAME_TAKEN`，不然兩個請求同時送出時，第二個會變成 500。

---

## 四、前端

### 圖示

- 不進資料庫。系統分類照舊用 `CATEGORY_ICON[code]`。
- 自訂分類一律用預設圖示（`code` 是 null 時查不到，顯示 `•` 或同風格的預設圖）。
- 以後真的要讓使用者選圖示，再加一個可為空的 `icon` 欄位、只存名稱（例如 `pet`），圖片留在前端。

### 型別修正（`code` 變成 `string | null`）

| 檔案 | 現在 | 改成 |
|---|---|---|
| `components/TransactionForm.vue:261` | `CATEGORY_ICON[c.code]` | `CATEGORY_ICON[c.code ?? '']` |
| `components/BillForm.vue:132` | `CATEGORY_ICON[c.code]` | `CATEGORY_ICON[c.code ?? '']` |

`pages/transactions.vue`、`pages/bills.vue` 的 `categoryCode()` 已經寫 `?.code ?? ''`，不用改。

### 停用分類的顯示（R9）

- `useLookups()` 的 `categories` 改成帶 `includeInactive=true`，交易列表、帳單列表才查得到已停用分類的名稱（現在只拿啟用的，停用後歷史交易會顯示空白）。
- 記帳、帳單表單的分類按鈕只顯示 `isActive` 的：**改 `useLookups()` 裡的 `categoriesOf`**（`composables/useResource.ts`，兩個表單都用它），改成 `filter((c) => c.type === type && c.isActive)`。`categories` 和 `categoryName` 不要過濾，歷史資料和編輯模式才找得到停用的分類。這兩個改動（`includeInactive` 和 `categoriesOf`）要在同一個 PR，不然表單會出現停用的分類，點了回 400。
- **編輯**舊交易或帳單時，如果它的分類已經停用：多顯示一顆「名稱（已停用）」的按鈕並保持選取，使用者沒改分類就照常可以儲存（後端只有分類有變更時才檢查）。

### 分類管理頁（新頁面）

- 由 B（Gianni）做。
- 路徑：獨立頁面 `/categories`（`pages/categories.vue`）。前端目前沒有設定頁，其他頁面也都是一層（`/accounts`、`/bills`…），照同樣的寫法。導覽列加一個「分類」。
- 用 `GET /categories?includeInactive=true` 列出，分「支出」「收入」兩個分頁。
- 系統分類：只顯示，不能操作。
- 自訂分類：改名、停用／啟用、刪除。
  - 刪除收到 409 `CATEGORY_IN_USE` → 提示「這個分類已經用過，可以改成停用」，並提供停用按鈕。
  - 收到 409 `CATEGORY_NAME_TAKEN` → 名稱欄位顯示錯誤。
- 新增：名稱＋類型（預設是目前的分頁），建立後不能改類型，畫面上要寫出來。
- 同類型啟用中已經 10 個時，新增按鈕改成不能按，並顯示「最多 10 個，可以停用不用的分類」（後端也會擋，回 409 `CATEGORY_LIMIT_REACHED`）。
- 快速記帳的分類區最後可以加一顆「＋ 新增分類」連到這頁（可選）。

---

## 五、PR 拆法

照 CLAUDE.md「改 API 時後端 PR 先合併」：

1. **後端 PR**（Jason，D 審 schema、E 審後端）：migration、seed、API、錯誤代碼、`openapi.json`、data-dictionary。
   因為 CI 會用這個 PR 的 `openapi.json` 檢查前端，第四節的兩行型別修正要放在同一個 PR，PR 說明寫原因，A、E 都審。
2. **前端 PR**（B，A 審）：`useLookups` 帶 `includeInactive`、表單顯示已停用分類、分類管理頁。

## 六、測試要改或要補

- 要改：`test/utils/db.ts` 的 `createCategory` 帶 `userId` 時 `code` 寫 null；`bills.e2e-spec.ts`、`seed-categories.e2e-spec.ts` 裡建立「有 code 的自訂分類」的地方；`seed-categories.e2e-spec.ts` 的 `findUnique({ where: { code } })` 改 `findFirst`；`categories.e2e-spec.ts` 回應欄位多了 `isActive`。
- 要刪：`seed-categories.e2e-spec.ts` 的「code 已經是使用者的分類時丟錯」。
- 要補：`db-constraints.e2e-spec.ts` 的 CHECK 與兩個部分唯一索引；新端點的 e2e（R1–R8、R11 各一個；R11 要測「停用的不算」和「重新啟用時超過上限」）；「分類停用後繳費，下一期照常產生」（改帳單的情況已經在 `bills.e2e-spec.ts` 688 行）。

---

## 七、定案後

討論完把重要決定（R3 雙向 CHECK、R6／R7 名稱規則、系統分類對 PATCH／DELETE 回 404）寫進 `docs/decisions.md` D 組那一區，連結這份 SPEC，再把開頭的「草案」拿掉。

## 八、待確認

已決定（2026/11/28，D）：

- ~~上限~~ → 每種類型 10 個（R11）
- ~~調整順序~~ → 不做，依名稱排（R12）
- ~~隱藏系統分類~~ → 不行（R13）

- ~~分類管理頁誰做~~ → B（Gianni）
- ~~放在哪裡~~ → 獨立頁面 `/categories`（建議，B 確認）
