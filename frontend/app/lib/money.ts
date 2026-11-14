/**
 * 金額工具。API 的金額是字串（"1234.00"），前端只做「顯示」與「輸入驗證」，
 * 不在前端計算餘額或合計（PRD §15：所有數字由後端計算）。
 * 唯一例外是 mock API，內部用「分」為單位的整數計算，避免浮點誤差。
 */

/** 最多 12 位整數、2 位小數（PRD §13 DTO 規則） */
export const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/
const SIGNED_AMOUNT_RE = /^-?\d{1,12}(\.\d{1,2})?$/

export function toCents(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  return Math.round(Number(v) * 100)
}

export function fromCents(c: number): string {
  const sign = c < 0 ? '-' : ''
  const abs = Math.abs(Math.round(c))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** NT$1,234 ／ NT$1,234.50 ／ -NT$500 */
export function formatMoney(v: string | number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '—'
  const cents = toCents(v)
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100).toLocaleString('en-US')
  const frac = abs % 100
  const body = `NT$${whole}${frac ? '.' + String(frac).padStart(2, '0') : ''}`
  if (cents < 0) return `-${body}`
  if (opts.signed && cents > 0) return `+${body}`
  return body
}

/** 簡短格式：12,000,000 → 1,200 萬 */
export function formatWan(v: string | number): string {
  const n = toCents(v) / 100
  if (Math.abs(n) >= 10000 && n % 10000 === 0) return `${(n / 10000).toLocaleString('en-US')} 萬`
  if (Math.abs(n) >= 10000) return `${(n / 10000).toLocaleString('en-US', { maximumFractionDigits: 1 })} 萬`
  return n.toLocaleString('en-US')
}

/** 輸入框 → API 字串（"1234" → "1234.00"） */
export function normalizeAmount(raw: string): string {
  return fromCents(toCents(raw.trim().replace(/,/g, '')))
}

/** 前端驗證，只為使用者體驗；後端才是唯一依據 */
export function validateAmount(
  raw: string,
  opts: { allowZero?: boolean; allowNegative?: boolean; label?: string } = {},
): string | undefined {
  const v = raw.trim().replace(/,/g, '')
  if (!v) return `請輸入${opts.label ?? '金額'}`
  const re = opts.allowNegative ? SIGNED_AMOUNT_RE : AMOUNT_RE
  if (!re.test(v)) {
    if (!opts.allowNegative && v.startsWith('-')) return `${opts.label ?? '金額'}不能是負數`
    return `${opts.label ?? '金額'}必須是數字（最多 2 位小數）`
  }
  const c = toCents(v)
  if (!opts.allowZero && !opts.allowNegative && c <= 0) return `${opts.label ?? '金額'}必須大於 0`
  return undefined
}
