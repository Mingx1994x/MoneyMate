/**
 * Demo 資料（PRD §28）。日期都相對於「今天」產生，所以任何時候打開都像最新的資料。
 * - Demo 帳號已完成問卷（每月 4 萬）
 * - 現金、銀行、投資、信用卡＋1 個已轉換過的估計帳戶
 * - 約 6 個月的收入、支出、轉帳（含繳卡費），以及 1 筆預先記帳的未來收入
 * - 1 筆房貸（餘額 60 天前更新 → 觸發提醒）
 * - 帳單：1 張逾期、1 張 14 天內到期、1 張每月重複且已繳 3 期、1 張年度帳單
 */
import { addDays, addMonthsClamped, daysInMonth, make, parse } from '../lib/date'
import { loanPaymentPreview } from '../lib/finance'
import type { AccountRow, BillRow, DB, TxRow } from './db'

export const DEMO_EMAIL = 'demo@moneymate.local'
export const DEMO_PASSWORD = 'demo1234' // 只用於瀏覽器內的 mock；正式 seed 從環境變數讀取
const UID = 'demo-user'

export function seedDemo(db: DB, today: string) {
  // 只清掉 Demo 帳號自己的資料
  db.users = db.users.filter((u) => u.id !== UID)
  db.accounts = db.accounts.filter((a) => a.userId !== UID)
  db.transactions = db.transactions.filter((t) => t.userId !== UID)
  db.loans = db.loans.filter((l) => l.userId !== UID)
  db.bills = db.bills.filter((b) => b.userId !== UID)
  db.goals = db.goals.filter((g) => g.userId !== UID)

  const { y, m } = parse(today)
  const thisMonth = make(y, m, 1)
  const start = addMonthsClamped(thisMonth, -5)
  const created = `${start}T01:00:00.000Z`

  db.users.push({ id: UID, email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: 'Demo', createdAt: created })
  db.goals.push({
    userId: UID, name: '財富自由', monthlySpending: 40_000_00, targetAmount: 12_000_000_00,
    birthYear: 1996, estMonthlySaving: null, createdAt: created, updatedAt: created,
  })

  const acc = (id: string, name: string, accountType: AccountRow['accountType'], opening: number, extra: Partial<AccountRow> = {}): AccountRow => ({
    id, userId: UID, name, accountType, openingBalance: opening * 100, isActive: true, isEstimate: false,
    deductedFromEstimate: null, note: null, createdAt: created, updatedAt: created, ...extra,
  })
  db.accounts.push(
    acc('demo-cash', '現金錢包', 'cash', 5_000),
    acc('demo-bank', '台新銀行', 'bank', 80_000, { note: '薪轉帳戶' }),
    acc('demo-invest', '元大證券', 'investment', 300_000, { deductedFromEstimate: 300_000_00 }),
    acc('demo-card', '國泰世華信用卡', 'credit_card', 0),
    acc('demo-estimate', '現有資產（估計）', 'bank', 200_000, { isEstimate: true, note: '問卷填 50 萬，已轉 30 萬到元大證券' }),
  )

  // ---------- 貸款 ----------
  const loanEnd = addMonthsClamped(make(y + 20, m, 1), 0, 5)
  const loanMonthly = loanPaymentPreview(4_200_000, 2.1, loanEnd, today).monthlyPayment
  db.loans.push({
    id: 'demo-loan', userId: UID, name: '自住房貸', loanType: '房貸', outstandingBalance: 4_200_000_00,
    monthlyPayment: loanMonthly * 100, paymentDay: 5, endDate: loanEnd, interestRate: '2.1', status: 'active',
    balanceUpdatedAt: `${addDays(today, -60)}T04:00:00.000Z`, note: null, createdAt: created, updatedAt: created,
  })

  // ---------- 交易 ----------
  let seq = 0
  let rnd = 20261019
  const rand = (min: number, max: number) => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648
    return min + (rnd % (max - min + 1))
  }
  const tx = (date: string, type: TxRow['transactionType'], amount: number, accountId: string, opt: Partial<TxRow> = {}) => {
    if (date > today && !opt.note?.includes('預先')) return
    seq += 1
    db.transactions.push({
      id: `demo-tx-${seq}`, userId: UID, transactionType: type, amount: Math.round(amount * 100), accountId,
      toAccountId: null, categoryId: null, transactionDate: date, note: null, billId: null,
      createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`, ...opt,
    })
  }

  const FOODS = ['早餐', '午餐', '晚餐', '咖啡', '超商', '便當', '火鍋', '飲料']
  let cardSpendPrev = 0
  for (let i = 0; i < 6; i++) {
    const ms = addMonthsClamped(start, i)
    const { y: yy, m: mm } = parse(ms)
    const day = (d: number) => make(yy, mm, Math.min(d, daysInMonth(yy, mm)))
    let cardSpend = 0

    tx(day(5), 'income', 52_000, 'demo-bank', { categoryId: 'cat-salary', note: '薪水' })
    tx(day(5), 'expense', loanMonthly, 'demo-bank', { categoryId: 'cat-loan', note: '房貸' })
    tx(day(2), 'expense', 1_280, 'demo-bank', { categoryId: 'cat-transport', note: '捷運月票' })
    tx(day(6), 'transfer', 6_000, 'demo-bank', { toAccountId: 'demo-cash', note: '領現金' })
    if (i % 3 === 1) tx(day(20), 'income', 1_500, 'demo-invest', { categoryId: 'cat-investment-income', note: '股利' })

    for (let k = 0; k < 14; k++) {
      const d = day(rand(1, 28))
      const onCard = k % 2 === 0
      const amount = rand(6, 45) * 10
      tx(d, 'expense', amount, onCard ? 'demo-card' : 'demo-cash', { categoryId: 'cat-food', note: FOODS[rand(0, FOODS.length - 1)]! })
      if (onCard && d <= today) cardSpend += amount
    }
    for (const [d, amt, note] of [[12, rand(80, 260) * 10, '日用品'], [24, rand(30, 120) * 10, '衣服']] as const) {
      tx(day(d), 'expense', amt, 'demo-card', { categoryId: 'cat-living', note })
      if (day(d) <= today) cardSpend += amt
    }
    tx(day(10), 'expense', 390, 'demo-card', { categoryId: 'cat-subscription', note: '串流影音' })
    if (day(10) <= today) cardSpend += 390

    // 繳上個月的卡費（轉帳，不算支出）
    if (i > 0 && cardSpendPrev > 0) tx(day(15), 'transfer', cardSpendPrev, 'demo-bank', { toAccountId: 'demo-card', note: '繳卡費' })
    cardSpendPrev = cardSpend
  }

  // 預先記下個月的薪水：未來交易不影響目前餘額與本月收入（AC-19）
  const nextMonth = addMonthsClamped(thisMonth, 1, 5)
  tx(nextMonth, 'income', 52_000, 'demo-bank', { categoryId: 'cat-salary', note: '下個月薪水（預先記帳）' })

  // ---------- 帳單 ----------
  const bill = (id: string, name: string, amount: number, categoryId: string, dueDate: string, extra: Partial<BillRow>): BillRow => {
    const { m: dm, d } = parse(dueDate)
    return {
      id, userId: UID, name, amount: amount * 100, categoryId, accountId: 'demo-bank', dueDate, dueDay: d,
      dueMonth: extra.recurrence === 'yearly' ? dm : null, seriesId: `${id}-series`, recurrence: 'none',
      status: 'pending', paidAmount: null, paidDate: null, note: null, createdAt: created, updatedAt: created, ...extra,
    }
  }
  // 每月重複、已繳 3 期
  for (let k = 0; k < 3; k++) {
    const due = addMonthsClamped(thisMonth, k - 2, 1)
    const b = bill(`demo-bill-mgmt-${k}`, '社區管理費', 2_800, 'cat-housing', due, {
      seriesId: 'demo-mgmt-series', recurrence: 'monthly', status: 'paid', paidAmount: 2_800_00, paidDate: due,
    })
    db.bills.push(b)
    tx(due, 'expense', 2_800, 'demo-bank', { categoryId: 'cat-housing', note: '繳費：社區管理費', billId: b.id })
  }
  db.bills.push(
    bill('demo-bill-mgmt-3', '社區管理費', 2_800, 'cat-housing', addMonthsClamped(thisMonth, 1, 1), {
      seriesId: 'demo-mgmt-series', recurrence: 'monthly',
    }),
    bill('demo-bill-power', '電費', 1_850, 'cat-living', addDays(today, -3), { note: '兩個月一期' }),
    bill('demo-bill-net', '網路費', 1_199, 'cat-subscription', addDays(today, 6), { recurrence: 'monthly' }),
    bill('demo-bill-car', '汽車保險', 18_000, 'cat-insurance', addDays(today, 40), { recurrence: 'yearly' }),
  )
}
