import type { AccountType, Recurrence, TransactionType } from '~/types/api'

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: '現金',
  bank: '銀行',
  investment: '投資',
  credit_card: '信用卡',
}

export const ACCOUNT_TYPE_ICON: Record<AccountType, string> = {
  cash: '💵',
  bank: '🏦',
  investment: '📈',
  credit_card: '💳',
}

export const TX_TYPE_LABEL: Record<TransactionType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '轉帳',
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: '不重複',
  monthly: '每月',
  yearly: '每年',
}

export const LOAN_TYPES = ['房貸', '車貸', '信貸', '學貸', '其他']

export const CATEGORY_ICON: Record<string, string> = {
  salary: '💼',
  investment_income: '📈',
  other_income: '🎁',
  food: '🍱',
  transport: '🚇',
  living: '🧺',
  housing: '🏠',
  loan_payment: '🏦',
  insurance: '🛡️',
  tax: '🧾',
  subscription: '📺',
  other_expense: '📦',
}
