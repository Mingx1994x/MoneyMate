import type { ErrorCode } from './error-codes.js';

/**
 * 意思唯一的資料庫約束 → 錯誤代碼。
 * 鍵是 PostgreSQL 的索引或約束名稱（`cause.constraint.index`）。
 * CHECK、以及「刪除」和「寫入」意思不同的外鍵不要放進來。
 */
export const DB_CONSTRAINT_CODES = {
  users_email_key: { code: 'AUTH_EMAIL_TAKEN', field: 'email' },
  goals_user_id_key: { code: 'ONBOARDING_ALREADY_DONE' },
  accounts_one_estimate_per_user: { code: 'ONBOARDING_ALREADY_DONE' },
  transactions_bill_id_key: { code: 'BILL_ALREADY_PAID' },
} as const satisfies Record<string, { code: ErrorCode; field?: string }>;

/**
 * 刪除使用中的帳戶會撞到的複合外鍵。
 * 寫入別人的帳戶也是這些名字，所以不放進 DB_CONSTRAINT_CODES。
 * accounts.remove 自己接，其他操作撞到時維持 500。
 */
export const ACCOUNT_IN_USE_FKEYS = [
  'transactions_account_id_user_id_fkey',
  'transactions_to_account_id_user_id_fkey',
  'bills_account_id_user_id_fkey',
] as const;
