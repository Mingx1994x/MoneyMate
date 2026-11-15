import {
  dayInMonth,
  monthOf,
  nextMonthStart,
  type DateOnly,
} from '../../common/date-only.js';
import { Recurrence } from '../../prisma/index.js';

/** nextDueDate 需要的欄位（都是本期帳單的值） */
export interface DueDateRule {
  /** 本期的到期日 */
  dueDate: DateOnly;
  /** 原本的日（例如 31）；短月的到期日是當月最後一天，但 dueDay 不變 */
  dueDay: number;
  /** 年度帳單原本的月份（1–12）；只有 yearly 有值 */
  dueMonth: number | null;
  recurrence: Recurrence;
}

/**
 * 下一期的到期日（BILL-4，PRD 16.4）。純函式，不讀資料庫、不取時間。
 * - 一律從**本期的到期日**推算，不看繳費日：逾期補繳時，下一期可能立刻也是逾期（US-B19）。
 * - 日用 dueDay、不用本期到期日的日，所以短月之後會回到原本的日期：1/31 → 2/28 → 3/31。
 * - monthly：下一個月；yearly：下一年的 dueMonth 月。29–31 遇到短月用當月最後一天（閏年 2/29）。
 * - none 沒有下一期，呼叫端不該呼叫；yearly 沒有 dueMonth 是資料錯誤（POST／PATCH 保證有值）。兩種都丟 Error。
 */
export function nextDueDate(rule: DueDateRule): DateOnly {
  const { dueDate, dueDay, dueMonth, recurrence } = rule;
  switch (recurrence) {
    case Recurrence.monthly:
      return dayInMonth(monthOf(nextMonthStart(monthOf(dueDate))), dueDay);
    case Recurrence.yearly: {
      if (dueMonth === null || !Number.isInteger(dueMonth)) {
        throw new Error('nextDueDate: 年度帳單一定要有 dueMonth');
      }
      const year = Number(monthOf(dueDate).slice(0, 4)) + 1;
      return dayInMonth(`${year}-${String(dueMonth).padStart(2, '0')}`, dueDay);
    }
    case Recurrence.none:
      throw new Error('nextDueDate: 不重複的帳單沒有下一期');
  }
}
