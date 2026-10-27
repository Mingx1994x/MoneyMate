import type { ApiErrorBody } from '../types/api'

/** 後端錯誤格式（PRD §13） */
export class ApiError extends Error implements ApiErrorBody {
  statusCode: number
  code: string
  details: unknown[]
  requestId: string

  constructor(statusCode: number, code: string, message: string, details: unknown[] = []) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    this.requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
  }
}

/**
 * 錯誤代碼 → 給使用者看的中文。之後以 E 維護的 docs/error-codes.md 為準。
 * 沒列到的代碼就顯示後端的 message。
 */
export const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: '登入已過期，請重新登入',
  INVALID_CREDENTIALS: 'Email 或密碼不正確',
  EMAIL_TAKEN: '這個 Email 已經註冊過了',
  EMAIL_INVALID: 'Email 格式不正確',
  PASSWORD_INVALID: '密碼需要 8–72 個字元',
  TOO_MANY_REQUESTS: '嘗試次數太多，請稍後再試',
  ONBOARDING_ALREADY_DONE: '你已經完成問卷了',
  AMOUNT_INVALID: '金額格式不正確（最多 2 位小數）',
  AMOUNT_NOT_POSITIVE: '金額必須大於 0',
  OPENING_BALANCE_NEGATIVE: '只有信用卡的初始餘額可以是負數',
  NAME_INVALID: '名稱需要 1–30 個字',
  NOTE_INVALID: '備註最多 200 字',
  DATE_INVALID: '日期無效',
  ACCOUNT_NOT_FOUND: '找不到這個帳戶',
  CATEGORY_NOT_FOUND: '請選擇分類',
  CATEGORY_TYPE_MISMATCH: '分類和交易類型不符',
  TRANSFER_ACCOUNT_REQUIRED: '請選擇轉入帳戶',
  TRANSFER_SAME_ACCOUNT: '轉出和轉入不能是同一個帳戶',
  ACCOUNT_INACTIVE: '這個帳戶已停用，請先重新啟用',
  ACCOUNT_HAS_BALANCE: '帳戶餘額不是 0，不能停用',
  ACCOUNT_HAS_FUTURE_TRANSACTIONS: '帳戶還有未來日期的交易，不能停用',
  ACCOUNT_IN_USE: '這個帳戶有交易或被帳單使用，請改用停用',
  TRANSACTION_NOT_FOUND: '找不到這筆交易',
  BILL_LINKED_TRANSACTION: '這筆交易是帳單繳費產生的，請到帳單頁取消繳費',
  BILL_NOT_FOUND: '找不到這張帳單',
  BILL_ALREADY_PAID: '這張帳單已經繳過了',
  NEXT_BILL_ALREADY_PAID: '下一期已經繳費，請先取消下一期的繳費',
  PAID_DATE_IN_FUTURE: '繳費日期不能晚於今天',
  LOAN_NOT_FOUND: '找不到這筆貸款',
  LOAN_END_DATE_PAST: '結清日已過，狀態請選「已結清」',
  MONTHLY_PAYMENT_REQUIRED: '沒有年利率時，請自己填每月還款',
  VALIDATION_FAILED: '資料格式不正確',
  NETWORK_ERROR: '連線失敗，請稍後再試',
  INTERNAL_ERROR: '伺服器發生錯誤，資料沒有被儲存，請稍後再試',
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return ERROR_MESSAGES[e.code] ?? e.message
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    const code = (e as { code: string }).code
    return ERROR_MESSAGES[code] ?? ((e as { message?: string }).message || '發生錯誤')
  }
  return '發生未知錯誤，請稍後再試'
}
