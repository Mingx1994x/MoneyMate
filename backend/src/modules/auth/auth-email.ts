/** Email 一律去除前後空白、轉成小寫後儲存與比對（PRD 第七節；資料庫有 `email = lower(email)` 的 CHECK） */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 登入失敗次數的鍵：正規化後的 Email，最長 254 字元（Email 的上限）。
 * 沒有驗證的輸入可以很長，不截斷的話攻擊者能用超長字串撐大記憶體。
 */
export function attemptKey(normalizedEmail: string): string {
  return normalizedEmail.slice(0, 254);
}
