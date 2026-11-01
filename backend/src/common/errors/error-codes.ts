/**
 * 錯誤代碼表：唯一的來源。每個代碼的 HTTP 狀態碼與繁中訊息只寫在這裡，
 * docs/error-codes.md 是給人看的版本，error-codes.spec.ts 會檢查兩邊一致。
 *
 * - 依模組分段（`// ── <模組>（負責人）`），段內照字母排序；各人只改自己的段落。
 * - alsoAllowed：同一個代碼依位置回不同狀態碼（PRD 13：路徑上找不到是 404，
 *   body／query 引用不存在的資源是 400）。
 * - 訊息是可直接顯示的固定句子，不含使用者輸入的值。
 */
export interface ErrorCodeDef {
  status: number;
  alsoAllowed?: readonly number[];
  message: string;
}

export const ERROR_CODES = {
  // ── 共用（E）
  AUTH_UNAUTHENTICATED: { status: 401, message: '請先登入' },
  BAD_REQUEST: { status: 400, message: '請求格式不正確' },
  CONFLICT: { status: 409, message: '資料狀態已變更，請重新整理後再試' },
  FORBIDDEN: { status: 403, message: '沒有權限執行這個操作' },
  INTERNAL_ERROR: { status: 500, message: '系統發生錯誤，請稍後再試' },
  NOT_FOUND: { status: 404, message: '找不到要求的資源' },
  NOT_IMPLEMENTED: { status: 501, message: '這個功能還在開發中' },
  PAYLOAD_TOO_LARGE: { status: 413, message: '送出的資料太大' },
  TOO_MANY_REQUESTS: { status: 429, message: '操作太頻繁，請稍後再試' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: '不支援的資料格式' },
  VALIDATION_FAILED: {
    status: 400,
    message: '輸入的資料有誤，請檢查標示的欄位',
  },

  // ── 共用驗證（INF-4）
  AMOUNT_INVALID: { status: 400, message: '金額格式不正確' },
  AMOUNT_NEGATIVE: { status: 400, message: '金額不可為負數' },
  AMOUNT_NOT_POSITIVE: { status: 400, message: '金額必須大於 0' },
  AMOUNT_OVERFLOW: { status: 400, message: '金額超出可記錄的範圍' },
  NAME_INVALID: { status: 400, message: '名稱需為 1 到 30 個字' },

  // ── auth（D）
  AUTH_EMAIL_TAKEN: { status: 409, message: '這個 Email 已經註冊過了' },
  AUTH_INVALID_CREDENTIALS: { status: 401, message: 'Email 或密碼錯誤' },

  // ── onboarding（D）
  ONBOARDING_ALREADY_DONE: { status: 409, message: '已經完成問卷了' },
  ONBOARDING_REQUIRED: { status: 409, message: '請先完成問卷' },

  // ── accounts（C）
  ACCOUNT_DEACTIVATE_BLOCKED: {
    status: 409,
    message: '帳戶還有餘額或未來的交易，不能停用',
  },
  ACCOUNT_IN_USE: {
    status: 409,
    message: '這個帳戶已有交易或帳單，不能刪除，可以改成停用',
  },
  ACCOUNT_INACTIVE: { status: 409, message: '這個帳戶已停用，請先重新啟用' },
  ACCOUNT_NOT_FOUND: {
    status: 404,
    alsoAllowed: [400],
    message: '找不到這個帳戶',
  },
  OPENING_BALANCE_NEGATIVE: {
    status: 400,
    message: '非信用卡帳戶的初始餘額不可為負數',
  },

  // ── categories（C）
  CATEGORY_NOT_FOUND: { status: 400, message: '找不到這個分類' },
  CATEGORY_TYPE_MISMATCH: { status: 400, message: '分類的類型不符' },

  // ── transactions（C）
  BILL_LINKED_TRANSACTION: {
    status: 409,
    message: '這筆交易由帳單產生，請到帳單修改',
  },
  TRANSACTION_FIELDS_MISMATCH: {
    status: 400,
    message: '這種交易類型不能帶這個欄位',
  },
  TRANSACTION_NOT_FOUND: { status: 404, message: '找不到這筆交易' },
  TRANSFER_SAME_ACCOUNT: { status: 400, message: '不能轉帳給同一個帳戶' },

  // ── bills（E）
  BILL_ALREADY_PAID: { status: 409, message: '這張帳單已經繳過了' },
  BILL_NOT_FOUND: { status: 404, message: '找不到這張帳單' },
  BILL_NOT_PAID: { status: 409, message: '這張帳單還沒繳費' },
  NEXT_BILL_ALREADY_PAID: {
    status: 409,
    message: '下一期帳單已經繳費，不能取消這一期',
  },
  PAID_DATE_IN_FUTURE: { status: 400, message: '繳費日期不可晚於今天' },

  // ── loans（E）
  LOAN_END_DATE_IN_PAST: {
    status: 400,
    message: '結清日已經過了，請修改結清日，或把狀態設為已結清',
  },
  LOAN_MONTHLY_PAYMENT_REQUIRED: {
    status: 400,
    message: '沒有填年利率時，請自己填每月還款',
  },
  LOAN_NOT_FOUND: { status: 404, message: '找不到這筆貸款' },
} as const satisfies Record<string, ErrorCodeDef>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** ErrorResponseDto 的 Swagger enum（enumName: 'ErrorCode'） */
export const ERROR_CODE_VALUES = Object.keys(ERROR_CODES) as ErrorCode[];

export interface ErrorDetail {
  /** 請求中的屬性路徑，與送出的 camelCase 名稱相同（例如 endDate、items.0.amount） */
  field: string;
  code: ErrorCode;
  message: string;
}

/** 組 details 的元素；訊息一律取自代碼表，不要手寫。 */
export function detail(field: string, code: ErrorCode): ErrorDetail {
  return { field, code, message: ERROR_CODES[code].message };
}
