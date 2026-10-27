import type { DateOnly } from '../../common/date-only.js';

/**
 * getBillAlerts 的回傳型別（給 C 的 Dashboard，PRD 15.5、16.7）。不經 HTTP，所以是 interface 不是 DTO。
 * 欄位名稱對齊 Dashboard 的 DashboardBillBriefDto（id、daysUntilDue），C 可以直接對應。
 */
export interface BillAlertItem {
  /** 帳單 ID */
  id: string;
  name: string;
  /** 預定金額，金額字串 */
  amount: string;
  dueDate: DateOnly;
  accountId: string;
  /** 到期日 − 台北今天的天數；逾期是負數、今天到期是 0 */
  daysUntilDue: number;
}

/**
 * 只看待繳帳單。兩個清單都回全部、不截斷（C 決定顯示前 5 筆），排序都是 dueDate 由舊到新，再依 name、id。
 * 「今天要處理的帳單」＝ overdue ＋ dueSoon 中 daysUntilDue === 0 的，由 C 自己組合。
 */
export interface BillAlerts {
  /** dueDate 早於今天 */
  overdue: BillAlertItem[];
  overdueCount: number;
  /** 今天 ≤ dueDate ≤ 今天＋14 天（第 14 天算入，第 15 天不算）；只包含現有的待繳帳單，不推算之後各期 */
  dueSoon: BillAlertItem[];
  dueSoonCount: number;
  /**
   * dueSoon 的預定金額合計（逾期的不算入），金額字串；dueSoon 是空的時是 '0.00'。
   * 資金缺口由 C 用它減掉可用現金計算，沒有現金或銀行帳戶時的 null 也由 C 判斷（Q3）。
   */
  dueTotal: string;
}
