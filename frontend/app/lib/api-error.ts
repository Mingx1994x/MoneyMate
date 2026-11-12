import type { ApiErrorBody } from '../types/api'

/** 跟欄位有關的錯誤（docs/error-codes.md）：field 是請求裡的屬性名稱（camelCase） */
export interface ErrorDetail {
  field: string
  code: string
  message: string
}

/** 後端錯誤格式（PRD §13、docs/error-codes.md） */
export class ApiError extends Error implements ApiErrorBody {
  statusCode: number
  code: string
  details: ErrorDetail[]
  requestId: string
  /** 429 才有：幾秒後可以再試 */
  retryAfterSeconds?: number

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details: ErrorDetail[] = [],
    extra: { requestId?: string; retryAfterSeconds?: number } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    this.requestId =
      extra.requestId ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()))
    this.retryAfterSeconds = extra.retryAfterSeconds
  }
}

/**
 * 前端自己的錯誤文字。原則上畫面顯示後端回傳的 message（docs/error-codes.md），
 * 這張表只放前端自己的代碼；表裡沒有的代碼就顯示後端的 message。
 */
export const ERROR_MESSAGES: Record<string, string> = {
  // 前端自己的代碼：連不上後端時用（後端沒有這個代碼）
  NETWORK_ERROR: '連不上伺服器，請確認網路或稍後再試',

  // 改用後端的 message，舊資料對齊後移除
  // ---- 共用（E） ----
  // AUTH_UNAUTHENTICATED: '登入已過期，請重新登入',
  // TOO_MANY_REQUESTS: '操作太頻繁，請稍後再試',
  // VALIDATION_FAILED: '輸入的資料有誤，請檢查標示的欄位',
  // NOT_IMPLEMENTED: '這個功能還在開發中，準備好就能使用',
  // INTERNAL_ERROR: '伺服器發生錯誤，資料沒有被儲存，請稍後再試',
  // ---- auth（D） ----
  // AUTH_EMAIL_TAKEN: '這個 Email 已經註冊過了',
  // AUTH_INVALID_CREDENTIALS: 'Email 或密碼錯誤',
  // ---- demo 時期的文字，代碼名稱已和後端相同 ----
  // ONBOARDING_ALREADY_DONE: '你已經完成問卷了',
  // AMOUNT_INVALID: '金額格式不正確（最多 2 位小數）',
  // AMOUNT_NOT_POSITIVE: '金額必須大於 0',
  // OPENING_BALANCE_NEGATIVE: '只有信用卡的初始餘額可以是負數',
  // NAME_INVALID: '名稱需要 1–30 個字',
  // ACCOUNT_NOT_FOUND: '找不到這個帳戶',
  // CATEGORY_NOT_FOUND: '請選擇分類',
  // CATEGORY_TYPE_MISMATCH: '分類和交易類型不符',
  // TRANSFER_SAME_ACCOUNT: '轉出和轉入不能是同一個帳戶',
  // ACCOUNT_INACTIVE: '這個帳戶已停用，請先重新啟用',
  // ACCOUNT_IN_USE: '這個帳戶有交易或被帳單使用，請改用停用',
  // TRANSACTION_NOT_FOUND: '找不到這筆交易',
  // BILL_LINKED_TRANSACTION: '這筆交易是帳單繳費產生的，請到帳單頁取消繳費',
  // BILL_NOT_FOUND: '找不到這張帳單',
  // BILL_ALREADY_PAID: '這張帳單已經繳過了',
  // NEXT_BILL_ALREADY_PAID: '下一期已經繳費，請先取消下一期的繳費',
  // PAID_DATE_IN_FUTURE: '繳費日期不能晚於今天',
  // LOAN_NOT_FOUND: '找不到這筆貸款',
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'TOO_MANY_REQUESTS' && e.retryAfterSeconds) {
      return `操作太頻繁，請 ${Math.ceil(e.retryAfterSeconds)} 秒後再試`
    }
    // 以後端的 message 為主；只有前端自己的代碼（ERROR_MESSAGES）才用前端的文字
    return ERROR_MESSAGES[e.code] ?? (e.message || '發生錯誤，請稍後再試')
  }
  return '發生未知錯誤，請稍後再試'
}

/**
 * 把後端的 details 轉成「欄位 → 訊息」，表單可以把錯誤顯示在對應的欄位下面。
 * 例：註冊時 Email 重複 → { email: '這個 Email 已經註冊過了' }
 */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {}
  const out: Record<string, string> = {}
  for (const d of e.details) {
    if (d.field && !out[d.field]) out[d.field] = ERROR_MESSAGES[d.code] ?? d.message
  }
  return out
}
