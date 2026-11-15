import { fromDbDate, type DateOnly } from '../../common/date-only.js';
import { toMoneyString } from '../../common/money.js';
import { BillStatus, type Bill } from '../../prisma/index.js';
import type { BillResponseDto } from './dto/bill-response.dto.js';

/**
 * 資料表的一筆帳單 → 回應。不放 userId。
 * - 金額一律 2 位小數字串；日期用 fromDbDate 轉，不受程序時區影響。
 * - isOverdue 是待繳且到期日早於台北今天；today 由呼叫端用 ClockService 取得（一個請求只取一次）。
 */
export function toBillResponse(bill: Bill, today: DateOnly): BillResponseDto {
  const dueDate = fromDbDate(bill.dueDate);
  return {
    id: bill.id,
    seriesId: bill.seriesId,
    name: bill.name,
    amount: toMoneyString(bill.amount),
    categoryId: bill.categoryId,
    accountId: bill.accountId,
    dueDate,
    dueDay: bill.dueDay,
    dueMonth: bill.dueMonth,
    recurrence: bill.recurrence,
    status: bill.status,
    paidAmount:
      bill.paidAmount === null ? null : toMoneyString(bill.paidAmount),
    paidDate: bill.paidDate === null ? null : fromDbDate(bill.paidDate),
    isOverdue: bill.status === BillStatus.pending && dueDate < today,
    note: bill.note,
    createdAt: bill.createdAt.toISOString(),
    updatedAt: bill.updatedAt.toISOString(),
  };
}
