/**
 * Mock 資料庫：存在瀏覽器 localStorage。
 * 金額內部一律用「分」（整數）儲存，輸出給前端時才轉成 "1234.00" 字串。
 */
import type { AccountType, BillStatus, CategoryType, LoanStatus, Recurrence, TransactionType } from '../types/api'

export interface UserRow { id: string; email: string; password: string; displayName: string | null; createdAt: string }
export interface AccountRow {
  id: string; userId: string; name: string; accountType: AccountType; openingBalance: number
  isActive: boolean; isEstimate: boolean; deductedFromEstimate: number | null; note: string | null
  createdAt: string; updatedAt: string
}
export interface TxRow {
  id: string; userId: string; transactionType: TransactionType; amount: number; accountId: string
  toAccountId: string | null; categoryId: string | null; transactionDate: string; note: string | null
  billId: string | null; createdAt: string; updatedAt: string
}
export interface LoanRow {
  id: string; userId: string; name: string; loanType: string; outstandingBalance: number; monthlyPayment: number
  paymentDay: number; endDate: string; interestRate: string | null; status: LoanStatus; balanceUpdatedAt: string
  note: string | null; createdAt: string; updatedAt: string
}
export interface BillRow {
  id: string; userId: string; name: string; amount: number; categoryId: string; accountId: string
  dueDate: string; dueDay: number; dueMonth: number | null; seriesId: string; recurrence: Recurrence
  status: BillStatus; paidAmount: number | null; paidDate: string | null; note: string | null
  createdAt: string; updatedAt: string
}
export interface GoalRow {
  userId: string; name: string; monthlySpending: number; targetAmount: number
  birthYear: number | null; estMonthlySaving: number | null; createdAt: string; updatedAt: string
}

export interface DB {
  version: 1
  users: UserRow[]
  accounts: AccountRow[]
  transactions: TxRow[]
  loans: LoanRow[]
  bills: BillRow[]
  goals: GoalRow[]
}

export interface CategoryRow { id: string; code: string; name: string; type: CategoryType; sortOrder: number }

/** 12 個系統分類（PRD FR-12、§14 categories） */
export const CATEGORIES: CategoryRow[] = [
  { id: 'cat-salary', code: 'salary', name: '薪資', type: 'income', sortOrder: 1 },
  { id: 'cat-investment-income', code: 'investment_income', name: '投資收入', type: 'income', sortOrder: 2 },
  { id: 'cat-other-income', code: 'other_income', name: '其他收入', type: 'income', sortOrder: 99 },
  { id: 'cat-food', code: 'food', name: '飲食', type: 'expense', sortOrder: 1 },
  { id: 'cat-transport', code: 'transport', name: '交通', type: 'expense', sortOrder: 2 },
  { id: 'cat-living', code: 'living', name: '生活', type: 'expense', sortOrder: 3 },
  { id: 'cat-housing', code: 'housing', name: '住房', type: 'expense', sortOrder: 4 },
  { id: 'cat-loan', code: 'loan_payment', name: '貸款還款', type: 'expense', sortOrder: 5 },
  { id: 'cat-insurance', code: 'insurance', name: '保險', type: 'expense', sortOrder: 6 },
  { id: 'cat-tax', code: 'tax', name: '稅費', type: 'expense', sortOrder: 7 },
  { id: 'cat-subscription', code: 'subscription', name: '訂閱', type: 'expense', sortOrder: 8 },
  { id: 'cat-other-expense', code: 'other_expense', name: '其他', type: 'expense', sortOrder: 99 },
]

export const STORAGE_KEY = 'moneymate-mock-db-v1'
export const FAIL_KEY = 'moneymate-mock-simulate-failure'

export function emptyDB(): DB {
  return { version: 1, users: [], accounts: [], transactions: [], loans: [], bills: [], goals: [] }
}

/** 可替換的儲存層，方便在 Node 測試 */
export interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

let idCounter = 0
export function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}
