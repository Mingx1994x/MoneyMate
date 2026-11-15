import {
  addYears,
  fromDbDate,
  toDbDate,
  type DateOnly,
} from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { Recurrence, type Bill, type Prisma } from '../../prisma/index.js';
import { nextDueDate } from './next-due-date.js';

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

/**
 * 繳費後產生的下一期（BILL-5）：同一個系列、待繳，name、amount、categoryId、accountId、recurrence、
 * dueDay、dueMonth、note 沿用本期。amount 是本期的預定金額，不是實繳金額（US-B3）。
 * dueDate 從本期的 dueDate 推算（nextDueDate），不看繳費日。呼叫端先確認 recurrence 不是 none。
 */
export function nextPeriodData(bill: Bill): Prisma.BillUncheckedCreateInput {
  return {
    userId: bill.userId,
    seriesId: bill.seriesId,
    name: bill.name,
    amount: bill.amount,
    categoryId: bill.categoryId,
    accountId: bill.accountId,
    dueDate: toDbDate(
      nextDueDate({
        dueDate: fromDbDate(bill.dueDate),
        dueDay: bill.dueDay,
        dueMonth: bill.dueMonth,
        recurrence: bill.recurrence,
      }),
    ),
    dueDay: bill.dueDay,
    dueMonth: bill.dueMonth,
    recurrence: bill.recurrence,
    note: bill.note,
  };
}

/**
 * 取消繳費時，改回待繳的這張要不要改成不重複（1109-BILL）。看的是同系列的待繳帳單（刪除之前）：
 * - 沒有：停止重複時選了刪除，或直接刪除了待繳帳單 → 改成不重複。
 * - 有，而且是不重複：停止重複時選了保留，或把待繳帳單改成不重複 → 改成不重複。
 * - 有，而且還是重複：一般情況（US-B6）→ 不改。
 * 不改成不重複的話，再繳費會替已經停止的系列產生下一期。
 */
export function stopsOnUnpay(
  pending: Pick<Bill, 'recurrence'> | null,
): boolean {
  return pending === null || pending.recurrence === Recurrence.none;
}
