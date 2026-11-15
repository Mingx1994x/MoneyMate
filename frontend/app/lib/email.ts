/**
 * Email 格式檢查，規則跟後端 RegisterDto 一致：只接受 ASCII、要有 @ 和網域的點、最多 254 字元。
 * 註冊、登入共用；登入的後端（LoginDto）只檢查有沒有填，格式不對也回 401，所以格式提示要前端自己做。
 */
const EMAIL_RE = /^[\x21-\x7e]+@[\x21-\x7e]+\.[\x21-\x7e]+$/

/** 回傳欄位錯誤訊息；沒問題回 undefined。會先去掉前後空白再檢查（後端也會 trim） */
export function validateEmail(value: string): string | undefined {
  const e = value.trim()
  if (!e) return '請輸入 Email'
  if (!EMAIL_RE.test(e) || e.length > 254) return 'Email 格式不正確（只能用英文、數字和符號）'
  return undefined
}
