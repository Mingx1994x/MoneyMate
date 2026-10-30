import type { DateOnly } from '../../common/date-only.js';

/**
 * getLoanSummary 的回傳型別（給 C 的 Dashboard，PRD 16.7）。不經 HTTP，所以是 interface 不是 DTO。
 * 欄位名稱對齊 Dashboard 的 DashboardLoansDto、DashboardLoanPaymentDto（#12），C 可以直接對應。
 */
export interface LoanUpcomingPayment {
  loanId: string;
  name: string;
  /** 還款日：min(paymentDay, 該月最後一天) */
  date: DateOnly;
  /** 每月還款，金額字串 */
  monthlyPayment: string;
  /** 還款日 − 台北今天的天數，0–14（名稱和帳單的 BillAlertItem 一致） */
  daysUntilDue: number;
}

/**
 * 只算 status 是 active 的貸款。沒有貸款時是 { activeCount: 0, outstandingTotal: '0.00', upcomingPayments: [] }，
 * 這是「有資料但是空」，Dashboard 不要放進 unavailable。
 */
export interface LoanSummary {
  activeCount: number;
  /** active 貸款的未償餘額合計，金額字串；和 C 的 getNetWorth 用同一個口徑（AC-22） */
  outstandingTotal: string;
  /**
   * 今天到今天＋14 天（含頭尾）的還款日，對今天所在月與下一個月各算一次；晚於 endDate 的不列（Q10）。
   * 依 date 由近到遠，再依 name、loanId；不限筆數。貸款不記錄這期繳了沒，所以已記還款支出也照樣列出。
   */
  upcomingPayments: LoanUpcomingPayment[];
}
