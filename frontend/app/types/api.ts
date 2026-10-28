/**
 * API 資料格式（依 PRD v0.5.8 第十三、十四節）。
 * ⚠️ 暫時手寫。後端 Swagger 完成後，改用 openapi-typescript 自動產生（§19），
 *    並把這個檔案換成 re-export 產生出來的型別。
 *
 * 慣例：JSON 欄位 camelCase；金額是字串（"1234.00"）；日期 YYYY-MM-DD；時間戳 ISO 8601 UTC。
 */

export type Money = string
export type DateString = string

// ---------- Auth ----------
export interface Me {
  id: string
  email: string
  displayName: string | null
  hasCompletedOnboarding: boolean
}
export interface AuthResponse {
  accessToken: string
  user: Me
}

// ---------- Accounts ----------
export type AccountType = 'cash' | 'bank' | 'investment' | 'credit_card'

export interface Account {
  id: string
  name: string
  accountType: AccountType
  currency: 'TWD'
  openingBalance: Money
  currentBalance: Money
  isActive: boolean
  isEstimate: boolean
  deductedFromEstimate: Money | null
  hasTransactions: boolean
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAccountBody {
  name: string
  accountType: AccountType
  openingBalance: Money
  note?: string | null
  deductFromEstimate?: boolean
}

// ---------- Categories ----------
export type CategoryType = 'income' | 'expense'
export interface Category {
  id: string
  code: string
  name: string
  type: CategoryType
  sortOrder: number
}

// ---------- Transactions ----------
export type TransactionType = 'income' | 'expense' | 'transfer'

export interface Transaction {
  id: string
  transactionType: TransactionType
  amount: Money
  accountId: string
  toAccountId: string | null
  categoryId: string | null
  transactionDate: DateString
  note: string | null
  billId: string | null
  isBillGenerated: boolean
  createdAt: string
  updatedAt: string
}

export interface TransactionBody {
  transactionType: TransactionType
  amount: Money
  accountId: string
  toAccountId?: string | null
  categoryId?: string | null
  transactionDate: DateString
  note?: string | null
}

/** 不分頁的列表也包一層 items（E 的後端統一規則）：GET /accounts、/categories、/loans、/bills */
export interface ListResponse<T> {
  items: T[]
}

export interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

// ---------- Loans ----------
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

// ---------- Bills ----------
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

// ---------- Goal ----------
export interface Goal {
  name: string
  monthlySpending: Money
  targetAmount: Money
  birthYear: number | null
  estMonthlySaving: Money | null
}

export interface Milestone {
  index: number
  amount: Money
  label: string
  reached: boolean
}

export type FireAgeStatus = 'ok' | 'achieved' | 'need_birth_year' | 'need_saving' | 'unreachable' | 'over_100'

export interface GoalProgress {
  targetAmount: Money
  currentAmount: Money
  remaining: Money
  percent: number
  achieved: boolean
  milestones: Milestone[]
  nextMilestone: (Milestone & { remaining: Money }) | null
  fireAge: number | null
  fireAgeStatus: FireAgeStatus
  fireAssumptions: {
    annualSpending: Money
    annualSaving: Money | null
    savingSource: 'actual' | 'estimate' | null
    currentAssets: Money
    age: number | null
  }
  activeLoanTotal: Money
}

// ---------- Dashboard ----------
export interface BillBrief {
  id: string
  name: string
  amount: Money
  dueDate: DateString
  daysUntilDue: number
}

export interface NextStep {
  type: 'overdue_bills' | 'funding_gap' | 'next_milestone' | 'goal_achieved' | 'onboarding'
  message: string
  amount: Money | null
}

export interface DashboardSummary {
  today: DateString
  month: string
  income: Money
  expense: Money
  savingsRate: number | null
  accountsTotal: Money
  netWorth: Money
  availableCash: Money
  hasCashAccounts: boolean
  billsOverdue: BillBrief[]
  billsOverdueCount: number
  billsDueSoon: BillBrief[]
  fundingGap: Money | null
  loans: {
    outstandingTotal: Money
    activeCount: number
    upcomingPayments: { loanId: string; name: string; date: DateString; monthlyPayment: Money }[]
  } | null
  goal: GoalProgress | null
  nextStep: NextStep
  unavailable: string[]
}

// ---------- Errors ----------
export interface ApiErrorBody {
  statusCode: number
  code: string
  message: string
  details: unknown[]
  requestId: string
}
