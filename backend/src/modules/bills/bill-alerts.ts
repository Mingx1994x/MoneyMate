import { addDays, daysBetween, type DateOnly } from '../../common/date-only.js';
import { Prisma } from '../../prisma/index.js';
import type { BillAlertItem, BillAlerts } from './bill-alerts.types.js';

/** 14 天內的範圍：今天到今天＋14 天（含頭尾），和貸款的還款日同一個範圍（D-011） */
export const DUE_SOON_DAYS = 14;

/** summarizeBillAlerts 需要的欄位。只傳待繳的帳單，由呼叫端過濾 */
export interface PendingBill {
  id: string;
  name: string;
  amount: Prisma.Decimal;
  dueDate: DateOnly;
  accountId: string;
}

/**
 * 算出 Dashboard 的帳單區塊（BILL-9，規則見 bill-alerts.types.ts）。純函式，不讀資料庫、不取時間，方便固定 today 測試。
 * 到期日晚於今天＋14 天的帳單直接略過；呼叫端可以先在查詢時排除，結果一樣。
 */
export function summarizeBillAlerts(
  bills: readonly PendingBill[],
  today: DateOnly,
): BillAlerts {
  const last = addDays(today, DUE_SOON_DAYS);
  const overdue: BillAlertItem[] = [];
  const dueSoon: BillAlertItem[] = [];

  for (const bill of bills) {
    if (bill.dueDate > last) continue;
    const item: BillAlertItem = {
      id: bill.id,
      name: bill.name,
      amount: bill.amount,
      dueDate: bill.dueDate,
      accountId: bill.accountId,
      daysUntilDue: daysBetween(today, bill.dueDate),
    };
    (bill.dueDate < today ? overdue : dueSoon).push(item);
  }
  overdue.sort(byDueDate);
  dueSoon.sort(byDueDate);

  return {
    overdue,
    overdueCount: overdue.length,
    dueSoon,
    dueSoonCount: dueSoon.length,
    // 逾期的不算入：資金缺口只看接下來 14 天要付的錢（Q3）
    dueTotal: dueSoon.reduce(
      (sum, b) => sum.plus(b.amount),
      new Prisma.Decimal(0),
    ),
  };
}

/** dueDate 由舊到新，再依 name、id */
function byDueDate(a: BillAlertItem, b: BillAlertItem): number {
  return (
    compare(a.dueDate, b.dueDate) ||
    compare(a.name, b.name) ||
    compare(a.id, b.id)
  );
}

// 用字元碼比較，不用 localeCompare：結果不受執行環境的語系影響
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
