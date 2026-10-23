/** `YYYY-MM-DD`。service 之間的 today 與所有日期參數都用這個型別；可直接用 <、=== 比較。 */
export type DateOnly = string;

/** `YYYY-MM` */
export type MonthString = string;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DAY_MS = 86_400_000;
// PostgreSQL 不接受 0000 年；更嚴格的範圍由各 DTO／service 檢查
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

/**
 * 格式正確、年份 1900–2999，而且是真的存在的日期（擋下 2026-02-30 這種會被 Date 進位成 3/2 的值）。
 * 任何輸入都只回 true／false，不丟錯。
 */
export function isDateOnly(v: unknown): v is DateOnly {
  if (typeof v !== 'string' || !DATE_ONLY_PATTERN.test(v)) return false;
  const year = Number(v.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const d = new Date(`${v}T00:00:00Z`);
  // 2026-13-01 這類值是 Invalid Date，直接 toISOString() 會丟 RangeError
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** 只在 Prisma 邊界使用：DateOnly → `@db.Date` 欄位的值（UTC 午夜）。 */
export function toDbDate(s: DateOnly): Date {
  if (!isDateOnly(s)) {
    throw new Error('toDbDate: 日期格式不正確');
  }
  return new Date(`${s}T00:00:00Z`);
}

/**
 * 只在 Prisma 邊界使用：`@db.Date` 欄位的值 → DateOnly。
 * 只接受 UTC 午夜；拿 new Date() 或 createdAt 這類時間戳來轉會在台北清晨差一天，所以直接丟錯。
 */
export function fromDbDate(d: Date): DateOnly {
  if (Number.isNaN(d.getTime()) || d.getTime() % DAY_MS !== 0) {
    throw new Error('fromDbDate: 不是 @db.Date 欄位的值（UTC 午夜）');
  }
  return d.toISOString().slice(0, 10);
}

/** 加減天數（n 為整數，可為負），以 UTC 計算；結果超出 1900–2999 就丟錯。 */
export function addDays(d: DateOnly, n: number): DateOnly {
  if (!Number.isInteger(n)) {
    throw new Error('addDays: 天數必須是整數');
  }
  const result = new Date(toDbDate(d).getTime() + n * DAY_MS);
  const s = Number.isNaN(result.getTime())
    ? ''
    : result.toISOString().slice(0, 10);
  if (!isDateOnly(s)) {
    throw new Error('addDays: 結果超出 1900–2999');
  }
  return s;
}

/** 日期不合法時丟錯。 */
export function monthOf(d: DateOnly): MonthString {
  if (!isDateOnly(d)) {
    throw new Error('monthOf: 日期格式不正確');
  }
  return d.slice(0, 7);
}

/**
 * `YYYY-MM`、月份 01–12、年份 1900–2999（2999-12 的下個月超出範圍，不接受）。
 * 任何輸入都只回 true／false，不丟錯。
 */
export function isMonthString(v: unknown): v is MonthString {
  return (
    typeof v === 'string' &&
    MONTH_PATTERN.test(v) &&
    isDateOnly(`${v}-01`) &&
    v !== `${MAX_YEAR}-12`
  );
}

/** 該月 1 日。查某月的資料用半開區間：gte monthStart(m)、lt nextMonthStart(m)。月份不合法時丟錯。 */
export function monthStart(m: MonthString): DateOnly {
  if (!isMonthString(m)) {
    throw new Error('monthStart: 月份格式不正確');
  }
  return `${m}-01`;
}

/** 下個月 1 日（12 月接到隔年 1 月）。月份不合法時丟錯。 */
export function nextMonthStart(m: MonthString): DateOnly {
  const first = monthStart(m);
  const year = Number(first.slice(0, 4));
  const month = Number(first.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}
