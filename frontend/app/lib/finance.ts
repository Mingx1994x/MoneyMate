/**
 * PRD 第十五節的純函式計算。
 * ⚠️ 正式版這些計算都在後端（C 的 FinanceCalcService、D 的財富自由年齡、E 的貸款月付），
 *    前端不可以自己算。這裡只給 mock API 使用，並用 PRD 的驗算案例測試過。
 */
import { monthDiff } from './date'

// ---------- 15.4 里程碑 ----------
export interface MilestoneDef {
  amount: number // 元
  label: string
}

export function buildMilestones(target: number): MilestoneDef[] {
  const candidates: MilestoneDef[] = [
    { amount: 100_000, label: '緊急預備金' },
    { amount: 1_000_000, label: '第一桶金' },
    { amount: target / 2, label: '一半' },
  ]
  const seen = new Set<number>()
  const out = candidates
    .filter((c) => c.amount < target)
    .sort((a, b) => a.amount - b.amount)
    .filter((c) => (seen.has(c.amount) ? false : (seen.add(c.amount), true)))
  out.push({ amount: target, label: '財富自由' })
  return out
}

// ---------- 15.8 貸款月付（本息平均攤還） ----------
export interface LoanPreviewResult {
  periods: number
  monthlyPayment: number // 元，已取整
  lastPayment: number
  totalInterest: number
}

/**
 * 每期月付、每期利息四捨五入到元；最後一期＝剩餘本金＋最後一期利息（吸收尾差）。
 * 驗算：1,000,000、3%、60 期 → 17,969／最後一期 17,949／總利息 78,120。
 */
export function loanPaymentPreview(
  principal: number,
  annualRatePercent: number,
  endDate: string,
  today: string,
): LoanPreviewResult {
  const n = Math.max(1, monthDiff(today, endDate) + 1)
  const r = annualRatePercent / 100 / 12
  if (principal <= 0) return { periods: n, monthlyPayment: 0, lastPayment: 0, totalInterest: 0 }

  const raw = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n))
  const pay = Math.round(raw)
  let remaining = principal
  let totalInterest = 0
  let last = 0
  for (let i = 1; i <= n; i++) {
    const interest = Math.round(remaining * r)
    totalInterest += interest
    if (i < n) {
      remaining -= pay - interest
    } else {
      last = Math.round((remaining + interest) * 100) / 100
    }
  }
  return { periods: n, monthlyPayment: n === 1 ? last : pay, lastPayment: last, totalInterest }
}

// ---------- 15.7 財富自由年齡 ----------
export interface FireInput {
  age: number | null
  annualSpending: number
  annualSaving: number | null
  currentAssets: number
  withdrawalRate?: number // 0.04
  returnRate?: number // 0.06
  inflationRate?: number // 0.02
}

export type FireResult =
  | { status: 'ok'; age: number; years: number; yearly: number[] }
  | { status: 'achieved' | 'need_birth_year' | 'need_saving' | 'unreachable' | 'over_100'; age: null; years: null; yearly: number[] }

export function fireAge(input: FireInput): FireResult {
  const wr = input.withdrawalRate ?? 0.04
  const real = (1 + (input.returnRate ?? 0.06)) / (1 + (input.inflationRate ?? 0.02)) - 1
  const target = input.annualSpending / wr
  const none = (status: Exclude<FireResult['status'], 'ok'>): FireResult => ({ status, age: null, years: null, yearly: [] })

  if (input.currentAssets >= target) return none('achieved')
  if (input.age === null) return none('need_birth_year')
  if (input.annualSaving === null) return none('need_saving')

  let assets = input.currentAssets
  const yearly: number[] = []
  for (let years = 1; input.age + years <= 100; years++) {
    const next = assets * (1 + real) + input.annualSaving
    yearly.push(next)
    if (next >= target) return { status: 'ok', age: input.age + years, years, yearly }
    // 資產不再成長（儲蓄 ≤ 0 且報酬補不回來）→ 永遠達不到
    if (next <= assets && input.annualSaving <= 0) return { ...none('unreachable'), yearly }
    assets = next
  }
  return { ...none('over_100'), yearly }
}
