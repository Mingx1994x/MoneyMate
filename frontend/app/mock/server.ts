/**
 * 瀏覽器內的「假後端」。路徑、欄位、錯誤代碼都照 PRD v0.5.8 第十三節，
 * 計算照第十五節、帳單流程照第十六節，讓前端在後端完成前就能完整操作與 Demo。
 *
 * 每個請求：從 storage 讀出整個 DB → 執行 → 成功才寫回。
 * 所以任何一步丟出錯誤，資料都不會被改到（等同資料庫交易的「全部成功才提交」）。
 *
 * ⚠️ 這裡的規則只是讓 Demo 能動的「參考實作」，正式規則以後端（C、D、E）為準。
 */
import { ApiError } from '../lib/api-error'
import { addDays, addMonthsClamped, daysInMonth, diffDays, isValidDate, make, monthOf, parse, todayTaipei } from '../lib/date'
import { buildMilestones, fireAge, loanPaymentPreview } from '../lib/finance'
import { AMOUNT_RE, fromCents, toCents } from '../lib/money'
import type {
  Account, Bill, BillBrief, Category, DashboardSummary, Goal, GoalProgress, Loan, Me, NextStep, Paginated, Transaction,
} from '../types/api'
import {
  CATEGORIES, emptyDB, newId, STORAGE_KEY,
  type AccountRow, type BillRow, type DB, type LoanRow, type Storage, type TxRow,
} from './db'
import { DEMO_EMAIL, seedDemo } from './seed'

export interface MockRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, unknown>
  body?: unknown
  token?: string | null
}

type Body = Record<string, unknown>
interface Ctx {
  db: DB
  userId: string
  today: string
  body: Body
  query: Record<string, unknown>
  params: string[]
}
type Handler = (ctx: Ctx) => unknown

const TOKEN_PREFIX = 'mock-token.'
const now = () => new Date().toISOString()

// ======================================================================
// 驗證小工具
// ======================================================================
const bad = (code: string, message: string) => new ApiError(400, code, message)
const conflict = (code: string, message: string) => new ApiError(409, code, message)
const notFound = (code: string, message: string) => new ApiError(404, code, message)

function parseAmount(v: unknown, opts: { allowZero?: boolean; allowNegative?: boolean } = {}): number {
  if (typeof v !== 'string' && typeof v !== 'number') throw bad('AMOUNT_INVALID', '金額格式不正確')
  const s = String(v).trim()
  const neg = s.startsWith('-')
  const abs = neg ? s.slice(1) : s
  if (!AMOUNT_RE.test(abs) || (neg && !opts.allowNegative)) {
    throw bad(neg ? 'AMOUNT_NOT_POSITIVE' : 'AMOUNT_INVALID', '金額格式不正確')
  }
  const c = toCents(s)
  if (c === 0 && !opts.allowZero) throw bad('AMOUNT_NOT_POSITIVE', '金額必須大於 0')
  return c
}

function parseName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length < 1 || s.length > 30) throw bad('NAME_INVALID', '名稱需要 1–30 個字')
  return s
}

function parseNote(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw bad('NOTE_INVALID', '備註格式不正確')
  const s = v.trim()
  if (s.length > 200) throw bad('NOTE_INVALID', '備註最多 200 字')
  return s || null
}

function parseDate(v: unknown): string {
  if (!isValidDate(v)) throw bad('DATE_INVALID', '日期無效')
  return v
}

function parseIntRange(v: unknown, min: number, max: number, code = 'VALIDATION_FAILED'): number {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw bad(code, `必須是 ${min}–${max} 的整數`)
  return n
}

const has = (b: Body, k: string) => Object.prototype.hasOwnProperty.call(b, k)

// ======================================================================
// 15.1 共用計算（等同 C 的 FinanceCalcService）
// ======================================================================
function balances(db: DB, userId: string, today: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const a of db.accounts) if (a.userId === userId) m.set(a.id, a.openingBalance)
  for (const t of db.transactions) {
    if (t.userId !== userId || t.transactionDate > today) continue // 未來交易不算
    const add = (id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v)
    if (t.transactionType === 'income') add(t.accountId, t.amount)
    else if (t.transactionType === 'expense') add(t.accountId, -t.amount)
    else {
      add(t.accountId, -t.amount)
      if (t.toAccountId) add(t.toAccountId, t.amount)
    }
  }
  return m
}

function calc(db: DB, userId: string, today: string) {
  const bal = balances(db, userId, today)
  const accounts = db.accounts.filter((a) => a.userId === userId)
  const accountsTotal = accounts.filter((a) => a.isActive).reduce((s, a) => s + (bal.get(a.id) ?? 0), 0)
  const allTotal = accounts.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0)
  const loanTotal = db.loans.filter((l) => l.userId === userId && l.status === 'active').reduce((s, l) => s + l.outstandingBalance, 0)
  const cashAccounts = accounts.filter((a) => a.isActive && !a.isEstimate && (a.accountType === 'cash' || a.accountType === 'bank'))
  const availableCash = cashAccounts.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0)
  return { bal, accountsTotal, netWorth: allTotal - loanTotal, loanTotal, availableCash, hasCashAccounts: cashAccounts.length > 0 }
}

function monthTotals(db: DB, userId: string, month: string, today: string) {
  let income = 0
  let expense = 0
  for (const t of db.transactions) {
    if (t.userId !== userId || t.transactionDate > today || monthOf(t.transactionDate) !== month) continue
    if (t.transactionType === 'income') income += t.amount
    if (t.transactionType === 'expense') expense += t.amount
  }
  return { income, expense }
}

/** 最近最多 6 個完整月的平均每月儲蓄；不足 3 個完整月回 null（15.6、15.7） */
function avgMonthlySaving(db: DB, userId: string, today: string): number | null {
  const txs = db.transactions.filter((t) => t.userId === userId && t.transactionDate <= today)
  if (txs.length === 0) return null
  const first = txs.reduce((min, t) => (t.transactionDate < min ? t.transactionDate : min), txs[0]!.transactionDate)
  const { y, m } = parse(today)
  const thisMonthStart = make(y, m, 1)
  const firstMonthStart = make(parse(first).y, parse(first).m, 1)
  const completeMonths = Math.min(6, Math.max(0, (y - parse(first).y) * 12 + (m - parse(first).m)))
  if (completeMonths < 3 || firstMonthStart >= thisMonthStart) return null
  let sum = 0
  for (let i = 1; i <= completeMonths; i++) {
    const mm = monthOf(addMonthsClamped(thisMonthStart, -i))
    const { income, expense } = monthTotals(db, userId, mm, today)
    sum += income - expense
  }
  return Math.round(sum / completeMonths)
}

// ======================================================================
// 輸出格式轉換（DB row → API JSON）
// ======================================================================
function accountOut(db: DB, a: AccountRow, bal: Map<string, number>): Account {
  return {
    id: a.id, name: a.name, accountType: a.accountType, currency: 'TWD',
    openingBalance: fromCents(a.openingBalance), currentBalance: fromCents(bal.get(a.id) ?? a.openingBalance),
    isActive: a.isActive, isEstimate: a.isEstimate,
    deductedFromEstimate: a.deductedFromEstimate === null ? null : fromCents(a.deductedFromEstimate),
    hasTransactions: db.transactions.some((t) => t.accountId === a.id || t.toAccountId === a.id),
    note: a.note, createdAt: a.createdAt, updatedAt: a.updatedAt,
  }
}

const txOut = (t: TxRow): Transaction => ({
  id: t.id, transactionType: t.transactionType, amount: fromCents(t.amount), accountId: t.accountId,
  toAccountId: t.toAccountId, categoryId: t.categoryId, transactionDate: t.transactionDate, note: t.note,
  billId: t.billId, isBillGenerated: t.billId !== null, createdAt: t.createdAt, updatedAt: t.updatedAt,
})

const loanOut = (l: LoanRow): Loan => ({
  id: l.id, name: l.name, loanType: l.loanType, outstandingBalance: fromCents(l.outstandingBalance),
  monthlyPayment: fromCents(l.monthlyPayment), paymentDay: l.paymentDay, endDate: l.endDate,
  interestRate: l.interestRate, status: l.status, balanceUpdatedAt: l.balanceUpdatedAt, note: l.note,
  createdAt: l.createdAt, updatedAt: l.updatedAt,
})

const billOut = (b: BillRow): Bill => ({
  id: b.id, name: b.name, amount: fromCents(b.amount), categoryId: b.categoryId, accountId: b.accountId,
  dueDate: b.dueDate, dueDay: b.dueDay, dueMonth: b.dueMonth, seriesId: b.seriesId, recurrence: b.recurrence,
  status: b.status, paidAmount: b.paidAmount === null ? null : fromCents(b.paidAmount), paidDate: b.paidDate,
  note: b.note, createdAt: b.createdAt, updatedAt: b.updatedAt,
})

// ======================================================================
// 擁有權檢查（不屬於登入者就當作不存在）
// ======================================================================
function ownAccount(ctx: Ctx, id: unknown, mode: 'body' | 'path' = 'body'): AccountRow {
  const a = ctx.db.accounts.find((x) => x.id === id && x.userId === ctx.userId)
  if (!a) throw mode === 'path' ? notFound('ACCOUNT_NOT_FOUND', '找不到帳戶') : bad('ACCOUNT_NOT_FOUND', '找不到帳戶')
  return a
}

function ownCategory(id: unknown, type?: 'income' | 'expense') {
  const c = CATEGORIES.find((x) => x.id === id)
  if (!c) throw bad('CATEGORY_NOT_FOUND', '找不到分類')
  if (type && c.type !== type) throw bad('CATEGORY_TYPE_MISMATCH', '分類和交易類型不符')
  return c
}

function estimateAccount(ctx: Ctx): AccountRow | undefined {
  return ctx.db.accounts.find((a) => a.userId === ctx.userId && a.isEstimate)
}

// ======================================================================
// Auth（D）
// ======================================================================
function meOut(db: DB, userId: string): Me {
  const u = db.users.find((x) => x.id === userId)!
  return {
    id: u.id, email: u.email, displayName: u.displayName,
    hasCompletedOnboarding: db.goals.some((g) => g.userId === userId),
  }
}

function register(db: DB, body: Body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('EMAIL_INVALID', 'Email 格式不正確')
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 8 || password.length > 72) throw bad('PASSWORD_INVALID', '密碼需要 8–72 個字元')
  if (db.users.some((u) => u.email === email)) throw conflict('EMAIL_TAKEN', '這個 Email 已經註冊過了')
  const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim().slice(0, 30) : null
  // ⚠️ Mock 只存在你的瀏覽器裡；正式後端用 bcrypt 雜湊
  const user = { id: newId('user'), email, password, displayName, createdAt: now() }
  db.users.push(user)
  return { accessToken: TOKEN_PREFIX + user.id, user: meOut(db, user.id) }
}

function login(db: DB, body: Body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const u = db.users.find((x) => x.email === email && x.password === body.password)
  if (!u) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email 或密碼不正確')
  return { accessToken: TOKEN_PREFIX + u.id, user: meOut(db, u.id) }
}

// ======================================================================
// 問卷、目標（D）
// ======================================================================
function onboarding(ctx: Ctx) {
  const { db, userId, body } = ctx
  if (db.goals.some((g) => g.userId === userId)) throw conflict('ONBOARDING_ALREADY_DONE', '已完成問卷')
  const spending = parseIntRange(body.monthlySpending, 1000, 333_000)
  let assets = 0
  if (body.currentAssets !== undefined && body.currentAssets !== null) {
    assets = parseIntRange(body.currentAssets, 0, 100_000_000)
  }
  const t = now()
  db.goals.push({
    userId, name: '財富自由', monthlySpending: spending * 100, targetAmount: spending * 300 * 100,
    birthYear: null, estMonthlySaving: null, createdAt: t, updatedAt: t,
  })
  db.accounts.push({
    id: newId('acc'), userId, name: '現有資產（估計）', accountType: 'bank', openingBalance: assets * 100,
    isActive: assets > 0, isEstimate: true, deductedFromEstimate: null, note: '問卷填的存款估計值',
    createdAt: t, updatedAt: t,
  })
  return goalProgress(ctx)
}

function goalOut(ctx: Ctx): Goal {
  const g = ctx.db.goals.find((x) => x.userId === ctx.userId)
  if (!g) throw notFound('GOAL_NOT_FOUND', '尚未完成問卷')
  return {
    name: g.name, monthlySpending: fromCents(g.monthlySpending), targetAmount: fromCents(g.targetAmount),
    birthYear: g.birthYear, estMonthlySaving: g.estMonthlySaving === null ? null : fromCents(g.estMonthlySaving),
  }
}

function patchGoal(ctx: Ctx) {
  const g = ctx.db.goals.find((x) => x.userId === ctx.userId)
  if (!g) throw notFound('GOAL_NOT_FOUND', '尚未完成問卷')
  const b = ctx.body
  if (has(b, 'monthlySpending')) {
    const s = parseIntRange(Number(b.monthlySpending), 1000, 333_000)
    g.monthlySpending = s * 100
    g.targetAmount = s * 300 * 100
  }
  if (has(b, 'birthYear')) {
    g.birthYear = b.birthYear === null ? null : parseIntRange(b.birthYear, 1900, parse(ctx.today).y)
  }
  if (has(b, 'estMonthlySaving')) {
    g.estMonthlySaving = b.estMonthlySaving === null ? null : parseAmount(b.estMonthlySaving, { allowZero: true, allowNegative: true })
  }
  g.updatedAt = now()
  return goalOut(ctx)
}

function goalProgress(ctx: Ctx): GoalProgress {
  const g = ctx.db.goals.find((x) => x.userId === ctx.userId)
  if (!g) throw notFound('GOAL_NOT_FOUND', '尚未完成問卷')
  const c = calc(ctx.db, ctx.userId, ctx.today)
  const target = g.targetAmount
  const current = c.accountsTotal
  const percent = current <= 0 ? 0 : current >= target ? 100 : Math.round((current / target) * 1000) / 10
  const defs = buildMilestones(target / 100)
  const milestones = defs.map((d, i) => ({
    index: i + 1, amount: fromCents(Math.round(d.amount * 100)), label: d.label, reached: current >= Math.round(d.amount * 100),
  }))
  const next = milestones.find((m) => !m.reached) ?? null

  // 15.7 財富自由年齡
  const actual = avgMonthlySaving(ctx.db, ctx.userId, ctx.today)
  const monthlySaving = actual ?? g.estMonthlySaving
  const age = g.birthYear === null ? null : parse(ctx.today).y - g.birthYear
  const fire = fireAge({
    age,
    annualSpending: (g.monthlySpending / 100) * 12,
    annualSaving: monthlySaving === null ? null : (monthlySaving / 100) * 12,
    currentAssets: current / 100,
  })

  return {
    targetAmount: fromCents(target), currentAmount: fromCents(current), remaining: fromCents(Math.max(0, target - current)),
    percent, achieved: current >= target, milestones,
    nextMilestone: next ? { ...next, remaining: fromCents(toCents(next.amount) - current) } : null,
    fireAge: fire.age, fireAgeStatus: fire.status,
    fireAssumptions: {
      annualSpending: fromCents(g.monthlySpending * 12),
      annualSaving: monthlySaving === null ? null : fromCents(monthlySaving * 12),
      savingSource: actual !== null ? 'actual' : g.estMonthlySaving !== null ? 'estimate' : null,
      currentAssets: fromCents(current), age,
    },
    activeLoanTotal: fromCents(c.loanTotal),
  }
}

// ======================================================================
// 帳戶（C）
// ======================================================================
const ACCOUNT_TYPES = ['cash', 'bank', 'investment', 'credit_card'] as const

function listAccounts(ctx: Ctx): { items: Account[] } {
  const { bal } = calc(ctx.db, ctx.userId, ctx.today)
  const includeInactive = ctx.query.includeInactive === true || ctx.query.includeInactive === 'true'
  const items = ctx.db.accounts
    .filter((a) => a.userId === ctx.userId && (includeInactive || a.isActive))
    .sort((a, b) => Number(a.isEstimate) - Number(b.isEstimate) || a.createdAt.localeCompare(b.createdAt))
    .map((a) => accountOut(ctx.db, a, bal))
  return { items }
}

function createAccount(ctx: Ctx): Account {
  const b = ctx.body
  const name = parseName(b.name)
  if (!ACCOUNT_TYPES.includes(b.accountType as never)) throw bad('VALIDATION_FAILED', '帳戶類型不正確')
  const accountType = b.accountType as AccountRow['accountType']
  const opening = parseAmount(b.openingBalance ?? '0', { allowZero: true, allowNegative: true })
  if (opening < 0 && accountType !== 'credit_card') throw bad('OPENING_BALANCE_NEGATIVE', '只有信用卡可以是負數')
  const t = now()
  const row: AccountRow = {
    id: newId('acc'), userId: ctx.userId, name, accountType, openingBalance: opening, isActive: true,
    isEstimate: false, deductedFromEstimate: null, note: parseNote(b.note), createdAt: t, updatedAt: t,
  }
  // 15.9 估計帳戶轉換：扣除＝min(X, 估計帳戶目前餘額)；扣到 0 自動停用
  if (b.deductFromEstimate === true && opening > 0) {
    const est = estimateAccount(ctx)
    if (est && est.isActive) {
      const estBal = calc(ctx.db, ctx.userId, ctx.today).bal.get(est.id) ?? 0
      const deduct = Math.min(opening, Math.max(0, estBal))
      if (deduct > 0) {
        est.openingBalance -= deduct
        est.updatedAt = t
        row.deductedFromEstimate = deduct
        if (estBal - deduct === 0) est.isActive = false
      }
    }
  }
  ctx.db.accounts.push(row)
  return accountOut(ctx.db, row, calc(ctx.db, ctx.userId, ctx.today).bal)
}

function patchAccount(ctx: Ctx): Account {
  const a = ownAccount(ctx, ctx.params[0], 'path')
  const b = ctx.body
  const keys = Object.keys(b)
  const onlyReactivate = keys.length === 1 && b.isActive === true
  if (!a.isActive && !onlyReactivate) throw conflict('ACCOUNT_INACTIVE', '停用的帳戶不能修改，請先重新啟用')

  if (has(b, 'name')) a.name = parseName(b.name)
  if (has(b, 'note')) a.note = parseNote(b.note)
  if (has(b, 'accountType')) {
    if (!ACCOUNT_TYPES.includes(b.accountType as never)) throw bad('VALIDATION_FAILED', '帳戶類型不正確')
    if (a.isEstimate) throw bad('VALIDATION_FAILED', '估計帳戶不能改類型')
    a.accountType = b.accountType as AccountRow['accountType']
  }
  if (has(b, 'openingBalance')) a.openingBalance = parseAmount(b.openingBalance, { allowZero: true, allowNegative: true })
  if (a.openingBalance < 0 && a.accountType !== 'credit_card') throw bad('OPENING_BALANCE_NEGATIVE', '只有信用卡可以是負數')

  if (b.isActive === false && a.isActive) {
    const bal = calc(ctx.db, ctx.userId, ctx.today).bal.get(a.id) ?? 0
    if (bal !== 0) throw conflict('ACCOUNT_HAS_BALANCE', '餘額不是 0，不能停用')
    const future = ctx.db.transactions.some(
      (t) => (t.accountId === a.id || t.toAccountId === a.id) && t.transactionDate > ctx.today,
    )
    if (future) throw conflict('ACCOUNT_HAS_FUTURE_TRANSACTIONS', '有未來日期的交易，不能停用')
    a.isActive = false
  } else if (b.isActive === true) {
    a.isActive = true
  }
  a.updatedAt = now()
  return accountOut(ctx.db, a, calc(ctx.db, ctx.userId, ctx.today).bal)
}

function deleteAccount(ctx: Ctx) {
  const a = ownAccount(ctx, ctx.params[0], 'path')
  if (a.isEstimate) throw conflict('ACCOUNT_IN_USE', '估計帳戶不能刪除，請改用停用')
  const used =
    ctx.db.transactions.some((t) => t.accountId === a.id || t.toAccountId === a.id) ||
    ctx.db.bills.some((x) => x.accountId === a.id)
  if (used) throw conflict('ACCOUNT_IN_USE', '有交易或被帳單使用，請改用停用')
  // 已跟 C 確認：DELETE /accounts/:id?addBackToEstimate=true；沒帶或 false 就不加回
  const addBack = ctx.query.addBackToEstimate === true || ctx.query.addBackToEstimate === 'true'
  if (addBack && a.deductedFromEstimate) {
    const est = estimateAccount(ctx)
    if (est) {
      est.openingBalance += a.deductedFromEstimate
      est.isActive = true
      est.updatedAt = now()
    }
  }
  ctx.db.accounts = ctx.db.accounts.filter((x) => x.id !== a.id)
  return null
}

// ======================================================================
// 交易（C）
// ======================================================================
function buildTx(ctx: Ctx, input: Body, existing?: TxRow): TxRow {
  const type = input.transactionType
  if (type !== 'income' && type !== 'expense' && type !== 'transfer') throw bad('VALIDATION_FAILED', '交易類型不正確')
  const amount = parseAmount(input.amount)
  const date = parseDate(input.transactionDate)
  const account = ownAccount(ctx, input.accountId)
  if (!account.isActive) throw conflict('ACCOUNT_INACTIVE', '帳戶已停用')
  let toAccountId: string | null = null
  let categoryId: string | null = null
  if (type === 'transfer') {
    if (!input.toAccountId) throw bad('TRANSFER_ACCOUNT_REQUIRED', '請選擇轉入帳戶')
    const to = ownAccount(ctx, input.toAccountId)
    if (to.id === account.id) throw bad('TRANSFER_SAME_ACCOUNT', '不能轉給同一個帳戶')
    if (!to.isActive) throw conflict('ACCOUNT_INACTIVE', '帳戶已停用')
    toAccountId = to.id
  } else {
    categoryId = ownCategory(input.categoryId, type).id
  }
  const t = now()
  return {
    id: existing?.id ?? newId('tx'), userId: ctx.userId, transactionType: type, amount, accountId: account.id,
    toAccountId, categoryId, transactionDate: date, note: parseNote(input.note), billId: existing?.billId ?? null,
    createdAt: existing?.createdAt ?? t, updatedAt: t,
  }
}

function listTransactions(ctx: Ctx): Paginated<Transaction> {
  const q = ctx.query
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20))
  const items = ctx.db.transactions
    .filter((t) => t.userId === ctx.userId)
    // 篩選參數名稱與 C 的後端一致：dateFrom、dateTo、transactionType
    .filter((t) => !q.dateFrom || t.transactionDate >= String(q.dateFrom))
    .filter((t) => !q.dateTo || t.transactionDate <= String(q.dateTo))
    .filter((t) => !q.transactionType || t.transactionType === q.transactionType)
    .filter((t) => !q.categoryId || t.categoryId === q.categoryId)
    .filter((t) => !q.accountId || t.accountId === q.accountId || t.toAccountId === q.accountId)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt))
  return { items: items.slice((page - 1) * pageSize, page * pageSize).map(txOut), page, pageSize, total: items.length }
}

function ownTx(ctx: Ctx): TxRow {
  const t = ctx.db.transactions.find((x) => x.id === ctx.params[0] && x.userId === ctx.userId)
  if (!t) throw notFound('TRANSACTION_NOT_FOUND', '找不到交易')
  return t
}

function assertTxAccountsActive(ctx: Ctx, t: TxRow) {
  for (const id of [t.accountId, t.toAccountId]) {
    if (!id) continue
    const a = ctx.db.accounts.find((x) => x.id === id)
    if (a && !a.isActive) throw conflict('ACCOUNT_INACTIVE', '帳戶已停用，請先重新啟用')
  }
}

function patchTransaction(ctx: Ctx): Transaction {
  const t = ownTx(ctx)
  if (t.billId) throw conflict('BILL_LINKED_TRANSACTION', '帳單產生的交易不能修改')
  assertTxAccountsActive(ctx, t)
  const merged: Body = {
    transactionType: t.transactionType, amount: fromCents(t.amount), accountId: t.accountId,
    toAccountId: t.toAccountId, categoryId: t.categoryId, transactionDate: t.transactionDate, note: t.note,
    ...ctx.body,
  }
  // 改成收入／支出時清掉轉入帳戶；改成轉帳時清掉分類
  if (merged.transactionType !== 'transfer') merged.toAccountId = null
  else merged.categoryId = null
  const next = buildTx(ctx, merged, t)
  Object.assign(t, next)
  return txOut(t)
}

function deleteTransaction(ctx: Ctx) {
  const t = ownTx(ctx)
  if (t.billId) throw conflict('BILL_LINKED_TRANSACTION', '帳單產生的交易不能刪除')
  assertTxAccountsActive(ctx, t)
  ctx.db.transactions = ctx.db.transactions.filter((x) => x.id !== t.id)
  return null
}

// ======================================================================
// 貸款（E）
// ======================================================================
function parseRate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  const s = String(v).trim()
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s) || Number(s) > 100) throw bad('VALIDATION_FAILED', '年利率需為 0–100，最多 3 位小數')
  return s
}

function buildLoan(ctx: Ctx, b: Body, existing?: LoanRow): LoanRow {
  const name = parseName(b.name)
  const loanType = typeof b.loanType === 'string' && b.loanType.trim() ? b.loanType.trim().slice(0, 30) : '其他'
  const outstanding = parseAmount(b.outstandingBalance, { allowZero: true })
  const paymentDay = parseIntRange(b.paymentDay, 1, 31)
  const endDate = parseDate(b.endDate)
  const status = b.status === 'closed' ? 'closed' : 'active'
  if (endDate < ctx.today && status !== 'closed') throw bad('LOAN_END_DATE_PAST', '結清日已過，狀態需為已結清')
  const rate = parseRate(b.interestRate)
  let monthly: number
  if (b.monthlyPayment !== undefined && b.monthlyPayment !== null && b.monthlyPayment !== '') {
    monthly = parseAmount(b.monthlyPayment)
  } else if (rate !== null) {
    monthly = loanPaymentPreview(outstanding / 100, Number(rate), endDate, ctx.today).monthlyPayment * 100
  } else if (outstanding === 0) {
    monthly = 0
  } else {
    throw bad('MONTHLY_PAYMENT_REQUIRED', '沒有年利率時請填每月還款')
  }
  const t = now()
  const balanceChanged = !existing || existing.outstandingBalance !== outstanding
  return {
    id: existing?.id ?? newId('loan'), userId: ctx.userId, name, loanType, outstandingBalance: outstanding,
    monthlyPayment: monthly, paymentDay, endDate, interestRate: rate, status,
    balanceUpdatedAt: balanceChanged ? t : existing!.balanceUpdatedAt, note: parseNote(b.note),
    createdAt: existing?.createdAt ?? t, updatedAt: t,
  }
}

function ownLoan(ctx: Ctx): LoanRow {
  const l = ctx.db.loans.find((x) => x.id === ctx.params[0] && x.userId === ctx.userId)
  if (!l) throw notFound('LOAN_NOT_FOUND', '找不到貸款')
  return l
}

function patchLoan(ctx: Ctx): Loan {
  const l = ownLoan(ctx)
  const merged: Body = { ...loanOut(l), ...ctx.body }
  // 有改餘額、利率或結清日，但沒帶月付 → 依新條件重算（與 POST 相同規則）
  if (!has(ctx.body, 'monthlyPayment') && ['outstandingBalance', 'interestRate', 'endDate'].some((k) => has(ctx.body, k))) {
    merged.monthlyPayment = merged.interestRate ? null : merged.monthlyPayment
  }
  Object.assign(l, buildLoan(ctx, merged, l))
  return loanOut(l)
}

function paymentPreview(ctx: Ctx) {
  const q = ctx.query
  const outstanding = parseAmount(String(q.outstandingBalance ?? ''), { allowZero: true })
  const rate = parseRate(q.interestRate)
  if (rate === null) throw bad('VALIDATION_FAILED', '請填年利率')
  const endDate = parseDate(q.endDate)
  const r = loanPaymentPreview(outstanding / 100, Number(rate), endDate, ctx.today)
  return {
    periods: r.periods, monthlyPayment: fromCents(r.monthlyPayment * 100),
    lastPayment: fromCents(Math.round(r.lastPayment * 100)), totalInterest: fromCents(r.totalInterest * 100),
  }
}

// ======================================================================
// 帳單（E）— 第十六節
// ======================================================================
function ownBill(ctx: Ctx): BillRow {
  const b = ctx.db.bills.find((x) => x.id === ctx.params[0] && x.userId === ctx.userId)
  if (!b) throw notFound('BILL_NOT_FOUND', '找不到帳單')
  return b
}

function validateBillRefs(ctx: Ctx, b: Body) {
  ownCategory(b.categoryId, 'expense')
  const acc = ownAccount(ctx, b.accountId)
  if (!acc.isActive) throw conflict('ACCOUNT_INACTIVE', '扣款帳戶已停用')
}

function createBill(ctx: Ctx): Bill {
  const b = ctx.body
  const name = parseName(b.name)
  const amount = parseAmount(b.amount)
  validateBillRefs(ctx, b)
  const dueDate = parseDate(b.dueDate)
  const recurrence = b.recurrence === 'monthly' || b.recurrence === 'yearly' ? b.recurrence : 'none'
  const { m, d } = parse(dueDate)
  const t = now()
  const row: BillRow = {
    id: newId('bill'), userId: ctx.userId, name, amount, categoryId: String(b.categoryId), accountId: String(b.accountId),
    dueDate, dueDay: d, dueMonth: recurrence === 'yearly' ? m : null, seriesId: newId('series'), recurrence,
    status: 'pending', paidAmount: null, paidDate: null, note: parseNote(b.note), createdAt: t, updatedAt: t,
  }
  ctx.db.bills.push(row)
  return billOut(row)
}

function patchBill(ctx: Ctx): Bill {
  const bill = ownBill(ctx)
  const b = ctx.body
  if (bill.status === 'paid') {
    const allowed = ['name', 'note']
    if (Object.keys(b).some((k) => !allowed.includes(k))) throw conflict('BILL_ALREADY_PAID', '已繳帳單只能改名稱與備註')
  }
  if (has(b, 'name')) bill.name = parseName(b.name)
  if (has(b, 'note')) bill.note = parseNote(b.note)
  if (has(b, 'amount')) bill.amount = parseAmount(b.amount)
  if (has(b, 'categoryId') || has(b, 'accountId')) {
    validateBillRefs(ctx, { categoryId: b.categoryId ?? bill.categoryId, accountId: b.accountId ?? bill.accountId })
    if (has(b, 'categoryId')) bill.categoryId = String(b.categoryId)
    if (has(b, 'accountId')) bill.accountId = String(b.accountId)
  }
  if (has(b, 'recurrence')) {
    bill.recurrence = b.recurrence === 'monthly' || b.recurrence === 'yearly' ? b.recurrence : 'none'
  }
  if (has(b, 'dueDate')) {
    bill.dueDate = parseDate(b.dueDate)
    bill.dueDay = parse(bill.dueDate).d
  }
  bill.dueMonth = bill.recurrence === 'yearly' ? parse(bill.dueDate).m : null
  bill.updatedAt = now()
  return billOut(bill)
}

function nextDueDate(b: BillRow): string {
  if (b.recurrence === 'monthly') return addMonthsClamped(b.dueDate, 1, b.dueDay)
  const { y } = parse(b.dueDate)
  const m = b.dueMonth ?? parse(b.dueDate).m
  return make(y + 1, m, Math.min(b.dueDay, daysInMonth(y + 1, m)))
}

function payBill(ctx: Ctx): Bill {
  const bill = ownBill(ctx)
  if (bill.status !== 'pending') throw conflict('BILL_ALREADY_PAID', '這張帳單已經繳過了')
  const acc = ctx.db.accounts.find((a) => a.id === bill.accountId)
  if (!acc || !acc.isActive) throw conflict('ACCOUNT_INACTIVE', '扣款帳戶已停用')
  const paidAmount = ctx.body.paidAmount !== undefined ? parseAmount(ctx.body.paidAmount) : bill.amount
  const paidDate = ctx.body.paidDate !== undefined ? parseDate(ctx.body.paidDate) : ctx.today
  if (paidDate > ctx.today) throw bad('PAID_DATE_IN_FUTURE', '繳費日期不能晚於今天')
  const t = now()
  ctx.db.transactions.push({
    id: newId('tx'), userId: ctx.userId, transactionType: 'expense', amount: paidAmount, accountId: bill.accountId,
    toAccountId: null, categoryId: bill.categoryId, transactionDate: paidDate, note: `繳費：${bill.name}`,
    billId: bill.id, createdAt: t, updatedAt: t,
  })
  bill.status = 'paid'
  bill.paidAmount = paidAmount
  bill.paidDate = paidDate
  bill.updatedAt = t
  if (bill.recurrence !== 'none') {
    ctx.db.bills.push({
      ...bill, id: newId('bill'), dueDate: nextDueDate(bill), status: 'pending', paidAmount: null, paidDate: null,
      createdAt: t, updatedAt: t,
    })
  }
  return billOut(bill)
}

function unpayBill(ctx: Ctx): Bill {
  const bill = ownBill(ctx)
  if (bill.status !== 'paid') throw conflict('BILL_NOT_PAID', '這張帳單還沒繳費')
  const later = ctx.db.bills.filter((x) => x.seriesId === bill.seriesId && x.dueDate > bill.dueDate)
  if (later.some((x) => x.status === 'paid')) throw conflict('NEXT_BILL_ALREADY_PAID', '下一期已繳，請先取消下一期')
  const laterIds = new Set(later.map((x) => x.id))
  ctx.db.bills = ctx.db.bills.filter((x) => !laterIds.has(x.id))
  ctx.db.transactions = ctx.db.transactions.filter((t) => t.billId !== bill.id)
  bill.status = 'pending'
  bill.paidAmount = null
  bill.paidDate = null
  bill.updatedAt = now()
  return billOut(bill)
}

function stopRecurrence(ctx: Ctx) {
  const bill = ownBill(ctx)
  const pending = ctx.db.bills
    .filter((x) => x.seriesId === bill.seriesId && x.status === 'pending')
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]
  if (!pending) return null
  pending.recurrence = 'none'
  pending.updatedAt = now()
  if (ctx.body.keepCurrent === false) ctx.db.bills = ctx.db.bills.filter((x) => x.id !== pending.id)
  return null
}

function deleteBill(ctx: Ctx) {
  const bill = ownBill(ctx)
  if (bill.status === 'paid') throw conflict('BILL_ALREADY_PAID', '已繳帳單請先取消繳費')
  ctx.db.bills = ctx.db.bills.filter((x) => x.id !== bill.id)
  return null
}

// ======================================================================
// Dashboard（C）— 15.5 一句下一步
// ======================================================================
function dashboard(ctx: Ctx): DashboardSummary {
  const { db, userId, today } = ctx
  const month = typeof ctx.query.month === 'string' && /^\d{4}-\d{2}$/.test(ctx.query.month) ? ctx.query.month : monthOf(today)
  const c = calc(db, userId, today)
  const { income, expense } = monthTotals(db, userId, month, today)
  const savingsRate = income === 0 ? null : Math.round(((income - expense) / income) * 1000) / 10

  const pending = db.bills.filter((b) => b.userId === userId && b.status === 'pending')
  const brief = (b: BillRow): BillBrief => ({
    id: b.id, name: b.name, amount: fromCents(b.amount), dueDate: b.dueDate, daysUntilDue: diffDays(today, b.dueDate),
  })
  const overdue = pending.filter((b) => b.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const horizon = addDays(today, 14)
  const dueSoon = pending.filter((b) => b.dueDate >= today && b.dueDate <= horizon).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const dueSoonTotal = dueSoon.reduce((s, b) => s + b.amount, 0)
  const fundingGap = c.hasCashAccounts && dueSoon.length > 0 ? Math.max(0, dueSoonTotal - c.availableCash) : null

  const activeLoans = db.loans.filter((l) => l.userId === userId && l.status === 'active')
  const upcomingPayments = activeLoans
    .map((l) => {
      const { y, m } = parse(today)
      let date = make(y, m, Math.min(l.paymentDay, daysInMonth(y, m)))
      if (date < today) date = addMonthsClamped(make(y, m, 1), 1, l.paymentDay)
      return { loanId: l.id, name: l.name, date, monthlyPayment: fromCents(l.monthlyPayment) }
    })
    .filter((p) => p.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))

  const hasGoal = db.goals.some((g) => g.userId === userId)
  const goal = hasGoal ? goalProgress(ctx) : null

  let nextStep: NextStep
  if (overdue.length > 0) {
    nextStep = { type: 'overdue_bills', message: `有 ${overdue.length} 張帳單逾期`, amount: null }
  } else if (fundingGap !== null && fundingGap > 0) {
    nextStep = {
      type: 'funding_gap',
      message: `未來 14 天的已知帳單，整體資金可能不足，差 ${(fundingGap / 100).toLocaleString('en-US')} 元`,
      amount: fromCents(fundingGap),
    }
  } else if (goal && goal.nextMilestone) {
    nextStep = {
      type: 'next_milestone',
      message: `再存 ${(toCents(goal.nextMilestone.remaining) / 100).toLocaleString('en-US')} 元就到第 ${goal.nextMilestone.index} 站！`,
      amount: goal.nextMilestone.remaining,
    }
  } else if (goal) {
    nextStep = { type: 'goal_achieved', message: '你已經達成財富自由目標了！', amount: null }
  } else {
    nextStep = { type: 'onboarding', message: '先完成 30 秒問卷', amount: null }
  }

  return {
    today, month, income: fromCents(income), expense: fromCents(expense), savingsRate,
    accountsTotal: fromCents(c.accountsTotal), netWorth: fromCents(c.netWorth), availableCash: fromCents(c.availableCash),
    hasCashAccounts: c.hasCashAccounts,
    billsOverdue: overdue.slice(0, 5).map(brief), billsOverdueCount: overdue.length,
    billsDueSoon: dueSoon.slice(0, 5).map(brief),
    fundingGap: fundingGap === null ? null : fromCents(fundingGap),
    loans: { outstandingTotal: fromCents(c.loanTotal), activeCount: activeLoans.length, upcomingPayments },
    goal, nextStep, unavailable: [],
  }
}

// ======================================================================
// 路由表
// ======================================================================
type Route = [MockRequest['method'], RegExp, Handler, { public?: boolean; write?: boolean }?]
const ID = '([^/]+)'
const routes: Route[] = [
  ['GET', /^\/health$/, () => ({ status: 'ok', database: 'ok (mock)' }), { public: true }],
  ['GET', /^\/auth\/me$/, (c) => meOut(c.db, c.userId)],
  ['POST', /^\/onboarding$/, onboarding, { write: true }],
  ['GET', /^\/goal$/, goalOut],
  ['PATCH', /^\/goal$/, patchGoal, { write: true }],
  ['GET', /^\/goal\/progress$/, goalProgress],
  ['GET', /^\/accounts$/, listAccounts],
  ['POST', /^\/accounts$/, createAccount, { write: true }],
  ['GET', new RegExp(`^/accounts/${ID}$`), (c) => accountOut(c.db, ownAccount(c, c.params[0], 'path'), calc(c.db, c.userId, c.today).bal)],
  ['PATCH', new RegExp(`^/accounts/${ID}$`), patchAccount, { write: true }],
  ['DELETE', new RegExp(`^/accounts/${ID}$`), deleteAccount, { write: true }],
  ['GET', /^\/categories$/, (c): { items: Category[] } => ({ items: CATEGORIES.filter((x) => !c.query.type || x.type === c.query.type).sort((a, b) => a.sortOrder - b.sortOrder) })],
  ['GET', /^\/transactions$/, listTransactions],
  ['POST', /^\/transactions$/, (c) => { const t = buildTx(c, c.body); c.db.transactions.push(t); return txOut(t) }, { write: true }],
  ['GET', new RegExp(`^/transactions/${ID}$`), (c) => txOut(ownTx(c))],
  ['PATCH', new RegExp(`^/transactions/${ID}$`), patchTransaction, { write: true }],
  ['DELETE', new RegExp(`^/transactions/${ID}$`), deleteTransaction, { write: true }],
  ['GET', /^\/loans\/payment-preview$/, paymentPreview],
  ['GET', /^\/loans$/, (c) => ({ items: c.db.loans.filter((l) => l.userId === c.userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(loanOut) })],
  ['POST', /^\/loans$/, (c) => { const l = buildLoan(c, c.body); c.db.loans.push(l); return loanOut(l) }, { write: true }],
  ['GET', new RegExp(`^/loans/${ID}$`), (c) => loanOut(ownLoan(c))],
  ['PATCH', new RegExp(`^/loans/${ID}$`), patchLoan, { write: true }],
  ['DELETE', new RegExp(`^/loans/${ID}$`), (c) => { const l = ownLoan(c); c.db.loans = c.db.loans.filter((x) => x.id !== l.id); return null }, { write: true }],
  ['GET', /^\/bills$/, (c) => ({ items: c.db.bills.filter((b) => b.userId === c.userId).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(billOut) })],
  ['POST', /^\/bills$/, createBill, { write: true }],
  ['GET', new RegExp(`^/bills/${ID}$`), (c) => billOut(ownBill(c))],
  ['PATCH', new RegExp(`^/bills/${ID}$`), patchBill, { write: true }],
  ['DELETE', new RegExp(`^/bills/${ID}$`), deleteBill, { write: true }],
  ['POST', new RegExp(`^/bills/${ID}/pay$`), payBill, { write: true }],
  ['POST', new RegExp(`^/bills/${ID}/unpay$`), unpayBill, { write: true }],
  ['POST', new RegExp(`^/bills/${ID}/stop-recurrence$`), stopRecurrence, { write: true }],
  ['GET', /^\/dashboard\/summary$/, dashboard],
]

// ======================================================================
// Server
// ======================================================================
export class MockServer {
  constructor(
    private storage: Storage,
    private clock: () => string = () => todayTaipei(),
  ) {}

  private load(): DB {
    const raw = this.storage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const db = JSON.parse(raw) as DB
        if (db.version === 1) return db
      } catch {
        /* 壞掉就重建 */
      }
    }
    const db = emptyDB()
    seedDemo(db, this.clock())
    this.storage.setItem(STORAGE_KEY, JSON.stringify(db))
    return db
  }

  /** 處理一個請求；成功才寫回 storage */
  handle(req: MockRequest): unknown {
    const db = this.load()
    const path = req.path.split('?')[0]!.replace(/\/+$/, '') || '/'
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Body
    const query = req.query ?? {}

    if (req.method === 'POST' && path === '/auth/register') return this.commit(db, register(db, body))
    if (req.method === 'POST' && path === '/auth/login') return login(db, body)

    for (const [method, re, handler, opts] of routes) {
      if (method !== req.method) continue
      const m = re.exec(path)
      if (!m) continue
      let userId = ''
      if (!opts?.public) {
        const token = req.token ?? ''
        userId = token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : ''
        if (!userId || !db.users.some((u) => u.id === userId)) throw new ApiError(401, 'UNAUTHORIZED', '請先登入')
      }
      const result = handler({ db, userId, today: this.clock(), body, query, params: m.slice(1) })
      return opts?.write ? this.commit(db, result) : result
    }
    throw new ApiError(404, 'NOT_FOUND', `找不到 API：${req.method} ${path}`)
  }

  private commit<T>(db: DB, result: T): T {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(db))
    return result
  }

  /** 只重建 Demo 帳號的資料，不動其他使用者（PRD §28） */
  resetDemo() {
    const db = this.load()
    seedDemo(db, this.clock())
    this.storage.setItem(STORAGE_KEY, JSON.stringify(db))
  }

  /** 清掉所有 mock 資料（包含自己註冊的帳號） */
  resetAll() {
    this.storage.removeItem(STORAGE_KEY)
  }
}

export { DEMO_EMAIL }
