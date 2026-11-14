/**
 * API 資料格式。
 *
 * 型別從後端的 `backend/openapi.json` 產生（`npm run api:types` → `app/types/openapi.ts`，不要手動改那個檔案），
 * 這裡只是幫常用的型別取比較短的名字。後端改了 API 卻沒重新產生時，CI 會失敗；
 * 產生後頁面用錯欄位的地方，`npm run typecheck` 會直接報錯。
 *
 * 慣例：JSON 欄位 camelCase；金額是字串（"1234.00"）；日期 YYYY-MM-DD；時間戳 ISO 8601 UTC。
 */
import type { components } from './openapi'

type Schemas = components['schemas']

export type Money = string
export type DateString = string

// ---------- Auth ----------
export type Me = Schemas['MeDto']
export type AuthResponse = Schemas['AuthResponseDto']

// ---------- Accounts ----------
export type AccountType = Schemas['AccountType']
export type Account = Schemas['AccountResponseDto']
export type CreateAccountBody = Schemas['CreateAccountDto']
export type UpdateAccountBody = Schemas['UpdateAccountDto']

// ---------- Categories ----------
export type CategoryType = Schemas['CategoryType']
export type Category = Schemas['CategoryResponseDto']

// ---------- Transactions ----------
export type TransactionType = Schemas['TransactionType']
export type Transaction = Schemas['TransactionResponseDto']
export type TransactionBody = Schemas['CreateTransactionDto']

/** 不分頁的列表也包一層 items（後端的統一規則）：GET /accounts、/categories、/loans */
export interface ListResponse<T> {
  items: T[]
}

/** 分頁的列表：GET /transactions、/bills */
export interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

// ---------- Goal ----------
export type Goal = Schemas['GoalDto']
export type Milestone = Schemas['MilestoneDto']
export type FireAgeStatus = Schemas['FireAgeStatus']
export type GoalProgress = Schemas['GoalProgressDto']

// ---------- Dashboard ----------
export type BillBrief = Schemas['DashboardBillBriefDto']
export type NextStep = Schemas['DashboardNextStepDto']
export type DashboardSection = Schemas['DashboardSection']
export type DashboardSummary = Schemas['DashboardSummaryResponseDto']

// ---------- Errors ----------
/** 後端的錯誤代碼（docs/error-codes.md）。前端自己的代碼（NETWORK_ERROR）不在這裡面 */
export type ErrorCode = Schemas['ErrorCode']

export interface ApiErrorBody {
  statusCode: number
  /** 後端的 ErrorCode，或前端自己的 NETWORK_ERROR */
  code: string
  message: string
  details: unknown[]
  requestId: string
}

// ---------- Loans、Bills：暫時手寫 ----------
// ⚠️ 後端的 loans、bills API 都完成了，產生的型別裡已經有 LoanResponseDto、BillResponseDto。
//    這裡暫時手寫是因為頁面還接假後端；#60（貸款頁）、#61（帳單頁）接 API 時改用產生的型別，和後端不同的地方：
//    - Loan.loanType 是 LoanType 列舉、interestRate 是 number
//    - LoanPaymentPreview 是 { monthlyPayment, totalInterest, installments }
//    - GET /bills 是分頁格式，Bill 多了 isOverdue
export type LoanStatus = 'active' | 'closed'

export interface Loan {
  id: string
  name: string
  loanType: string
  outstandingBalance: Money
  monthlyPayment: Money
  paymentDay: number
  endDate: DateString
  interestRate: string | null
  status: LoanStatus
  balanceUpdatedAt: string
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface LoanBody {
  name: string
  loanType: string
  outstandingBalance: Money
  monthlyPayment?: Money | null
  paymentDay: number
  endDate: DateString
  interestRate?: string | null
  status: LoanStatus
  note?: string | null
}

export interface LoanPaymentPreview {
  periods: number
  monthlyPayment: Money
  lastPayment: Money
  totalInterest: Money
}

export type Recurrence = 'none' | 'monthly' | 'yearly'
export type BillStatus = 'pending' | 'paid'

export interface Bill {
  id: string
  name: string
  amount: Money
  categoryId: string
  accountId: string
  dueDate: DateString
  dueDay: number
  dueMonth: number | null
  seriesId: string
  recurrence: Recurrence
  status: BillStatus
  paidAmount: Money | null
  paidDate: DateString | null
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface BillBody {
  name: string
  amount: Money
  categoryId: string
  accountId: string
  dueDate: DateString
  recurrence: Recurrence
  note?: string | null
}
