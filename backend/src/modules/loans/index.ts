// 其他模組只從這裡匯入貸款相關的東西（C 的 Dashboard 用 getLoanSummary）
export type { LoanSummary, LoanUpcomingPayment } from './loan-summary.types.js';
export { LoansModule } from './loans.module.js';
export { LoansService } from './loans.service.js';
