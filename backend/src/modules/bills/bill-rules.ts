import { addYears, type DateOnly } from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { Recurrence } from '../../prisma/index.js';

/** 到期日最晚到台北今天加幾年；新增、修改共用（同貸款的結清日） */
export const BILL_DUE_DATE_MAX_YEARS = 50;

/**
 * 到期日不可晚於台北今天加 50 年，否則 VALIDATION_FAILED（dueDate）。
 * 剛好 50 年可以；過去的日期也可以（建立後就是逾期）。
 */
export function assertDueDateNotTooFar(
  dueDate: DateOnly,
  today: DateOnly,
): void {
  if (dueDate > addYears(today, BILL_DUE_DATE_MAX_YEARS)) {
    throw AppException.forField('VALIDATION_FAILED', 'dueDate');
  }
}

/** dueDay 是到期日的日（例如 31），短月之後用來回到原本的日期 */
export function dueDayOf(dueDate: DateOnly): number {
  return Number(dueDate.slice(8, 10));
}

/** dueMonth 只有 yearly 有值：取到期日的月；其他週期一律是 null */
export function dueMonthOf(
  dueDate: DateOnly,
  recurrence: Recurrence,
): number | null {
  return recurrence === Recurrence.yearly ? Number(dueDate.slice(5, 7)) : null;
}

/** 分頁的一段：skip 筆之後取 take 筆 */
export interface PageSlice {
  skip: number;
  take: number;
}

/**
 * 列表排序是「待繳在前（到期日由近到遠）、已繳在後（由新到舊）」，兩組的方向不同，
 * Prisma 的 orderBy 寫不出來，所以分兩次查。這裡算出這一頁要從兩組各取哪一段。
 * firstTotal 是第一組（待繳）的總筆數；take 為 0 的那組不用查。
 */
export function splitPage(
  page: number,
  pageSize: number,
  firstTotal: number,
): { first: PageSlice; second: PageSlice } {
  const skip = (page - 1) * pageSize;
  const firstTake = Math.max(0, Math.min(pageSize, firstTotal - skip));
  return {
    first: { skip: Math.min(skip, firstTotal), take: firstTake },
    second: {
      skip: Math.max(0, skip - firstTotal),
      take: pageSize - firstTake,
    },
  };
}
