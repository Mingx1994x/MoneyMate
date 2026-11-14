/** 日期工具。「今天」一律用 Asia/Taipei（PRD §15）。日期字串一律 YYYY-MM-DD。 */

export function todayTaipei(now: Date = new Date()): string {
  // en-CA 的格式剛好是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y: y!, m: m!, d: d! }
}

export function make(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function isValidDate(iso: unknown): iso is string {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const { y, m, d } = parse(iso)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

function toUTC(iso: string): number {
  const { y, m, d } = parse(iso)
  return Date.UTC(y, m - 1, d)
}

export function addDays(iso: string, n: number): string {
  const t = new Date(toUTC(iso) + n * 86_400_000)
  return make(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** b − a 的天數 */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000)
}

/** 加 n 個月；日期用 day（例如 31），短月用當月最後一天（PRD §16.4） */
export function addMonthsClamped(iso: string, n: number, day?: number): string {
  const { y, m, d } = parse(iso)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return make(ny, nm, Math.min(day ?? d, daysInMonth(ny, nm)))
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/** 兩個日期之間相差幾個月份（只看年月） */
export function monthDiff(fromIso: string, toIso: string): number {
  const a = parse(fromIso)
  const b = parse(toIso)
  return (b.y - a.y) * 12 + (b.m - a.m)
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? iso.replaceAll('-', '/') : '—'
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
export function formatDateShort(iso: string): string {
  const { m, d } = parse(iso)
  const wd = new Date(toUTC(iso)).getUTCDay()
  return `${m}/${d}（${WEEKDAYS[wd]}）`
}

/** 「3 天後」「今天」「逾期 2 天」 */
export function relativeDue(days: number): string {
  if (days === 0) return '今天到期'
  if (days === 1) return '明天到期'
  if (days > 0) return `${days} 天後到期`
  return `逾期 ${-days} 天`
}

/** ISO 時間戳距今幾天（以台北日期計） */
export function daysSince(timestamp: string, today: string = todayTaipei()): number {
  return diffDays(todayTaipei(new Date(timestamp)), today)
}
