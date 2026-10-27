<script setup lang="ts">
/**
 * Dashboard —— 第一屏（3 個問題＋一句下一步）由 A 負責；往下的報表區塊（收支、帳單、貸款）由 B 負責。
 * 所有數字都來自一支 API：GET /dashboard/summary（PRD FR-19）。還沒完成的區塊會列在 unavailable，顯示「準備中」。
 */
import { addMonthsClamped, formatDateShort, monthOf, relativeDue, todayTaipei } from '~/lib/date'
import { formatMoney, formatWan, toCents } from '~/lib/money'
import type { DashboardSummary } from '~/types/api'

const api = useApi()
const { displayName } = useAuth()

const month = ref(monthOf(todayTaipei()))
const thisMonth = monthOf(todayTaipei())
const r = useResource(() => api.get<DashboardSummary>('/dashboard/summary', { month: month.value }), { watch: [month] })
const d = computed(() => r.data.value)
const shiftMonth = (n: number) => (month.value = monthOf(addMonthsClamped(`${month.value}-01`, n)))
const monthLabel = computed(() => `${Number(month.value.slice(5))} 月`)
const unavailable = (k: string) => d.value?.unavailable.includes(k)

/** 今天要處理：逾期＋今天到期 */
const todayBills = computed(() => [
  ...(d.value?.billsOverdue ?? []),
  ...(d.value?.billsDueSoon ?? []).filter((b) => b.daysUntilDue === 0),
])
const nextStepTone = computed(() => {
  const t = d.value?.nextStep.type
  if (t === 'overdue_bills') return 'from-rose-500 to-rose-600'
  if (t === 'funding_gap') return 'from-amber-500 to-orange-500'
  return 'from-brand-600 to-brand-800'
})
const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 11 ? '早安' : h < 18 ? '午安' : '晚安'
})
</script>

<template>
  <div>
    <StateView :loading="r.loading.value" :error="r.error.value" :has-data="!!d" @retry="r.reload">
      <template v-if="d">
        <p class="mb-3 text-sm text-slate-500">{{ greeting }}，{{ displayName }} 👋</p>
        <OwnerNote owner="A" text="第一屏（3 個問題＋一句下一步）由 A 負責，這裡是暫時版本；下方的報表區塊由 B 負責。" />

        <!-- ③ 一句下一步＋1 個大數字 -->
        <section class="mb-4 rounded-3xl bg-gradient-to-br p-6 text-white shadow-lg" :class="nextStepTone">
          <p class="text-sm font-medium text-white/80">現在只需要做這一件事</p>
          <p class="mt-2 text-2xl leading-snug font-bold sm:text-3xl">{{ d.nextStep.message }}</p>
          <div class="mt-4 flex flex-wrap gap-2">
            <NuxtLink v-if="d.nextStep.type === 'overdue_bills' || d.nextStep.type === 'funding_gap'" to="/bills">
              <AppButton variant="secondary">去看帳單</AppButton>
            </NuxtLink>
            <NuxtLink v-else-if="d.nextStep.type === 'onboarding'" to="/onboarding"><AppButton variant="secondary">開始問卷</AppButton></NuxtLink>
            <NuxtLink v-else to="/goal"><AppButton variant="secondary">看目標進度</AppButton></NuxtLink>
          </div>
          <p v-if="d.goal" class="mt-3 text-xs text-white/70">目標進度 {{ d.goal.percent }}%（{{ formatWan(d.goal.currentAmount) }} / {{ formatWan(d.goal.targetAmount) }}）</p>
        </section>

        <div class="grid gap-4 md:grid-cols-2">
          <!-- ① 今天有什麼帳單要處理？ -->
          <section class="card p-5">
            <h2 class="text-sm font-semibold text-slate-500">今天有什麼帳單要處理？</h2>
            <p v-if="todayBills.length === 0" class="mt-3 font-semibold text-emerald-700">✓ 今天沒有要處理的帳單</p>
            <ul v-else class="mt-3 space-y-2">
              <li v-for="b in todayBills" :key="b.id" class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <div>
                  <p class="font-semibold">{{ b.name }} <span class="num font-normal">{{ formatMoney(b.amount) }}</span></p>
                  <p class="text-xs" :class="b.daysUntilDue < 0 ? 'text-rose-600' : 'text-amber-700'">{{ relativeDue(b.daysUntilDue) }}</p>
                </div>
                <NuxtLink :to="{ path: '/bills', query: { pay: b.id } }"><AppButton size="sm">去繳費</AppButton></NuxtLink>
              </li>
              <li v-if="d.billsOverdueCount > d.billsOverdue.length" class="text-xs text-slate-500">還有 {{ d.billsOverdueCount - d.billsOverdue.length }} 張逾期帳單</li>
            </ul>
          </section>

          <!-- ② 這個月的錢夠不夠用？（14 天資金缺口） -->
          <section class="card p-5">
            <h2 class="text-sm font-semibold text-slate-500">接下來的錢夠不夠用？</h2>
            <template v-if="!d.hasCashAccounts">
              <p class="mt-3 text-slate-700">新增現金或銀行帳戶後，就能幫你檢查</p>
              <NuxtLink to="/accounts?new=1" class="mt-2 inline-block text-sm font-semibold text-brand-700">新增帳戶 →</NuxtLink>
            </template>
            <p v-else-if="d.fundingGap === null" class="mt-3 font-semibold text-emerald-700">✓ 未來 14 天沒有待繳帳單</p>
            <p v-else-if="toCents(d.fundingGap) === 0" class="mt-3 font-semibold text-emerald-700">✓ 14 天內的帳單付得出來</p>
            <div v-else class="mt-3">
              <p class="font-semibold text-amber-800">未來 14 天的已知帳單，整體資金可能不足</p>
              <p class="num mt-1 text-2xl font-bold text-amber-700">差 {{ formatMoney(d.fundingGap) }}</p>
            </div>
            <p v-if="d.hasCashAccounts" class="mt-2 text-xs text-slate-500">可用現金（現金＋銀行）{{ formatMoney(d.availableCash) }}；不含投資、信用卡與估計帳戶</p>
          </section>
        </div>

        <!-- ===== 以下報表區塊：B 負責 ===== -->
        <h2 class="mt-8 mb-3 text-lg font-bold text-slate-900">報表</h2>

        <section class="card mb-4 p-5">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">{{ monthLabel }}收支</h3>
            <div class="flex items-center gap-1">
              <AppButton size="sm" variant="ghost" aria-label="上個月" @click="shiftMonth(-1)">‹</AppButton>
              <span class="num text-sm text-slate-600">{{ month }}</span>
              <AppButton size="sm" variant="ghost" aria-label="下個月" :disabled="month >= thisMonth" @click="shiftMonth(1)">›</AppButton>
            </div>
          </div>
          <div v-if="unavailable('monthly')" class="py-6 text-center text-sm text-slate-400">準備中</div>
          <div v-else class="mt-3 grid grid-cols-3 gap-3">
            <div><p class="text-xs text-slate-500">收入</p><p class="num text-base font-bold text-emerald-700 sm:text-xl">{{ formatMoney(d.income) }}</p></div>
            <div><p class="text-xs text-slate-500">支出</p><p class="num text-base font-bold sm:text-xl">{{ formatMoney(d.expense) }}</p></div>
            <div>
              <p class="text-xs text-slate-500">儲蓄率</p>
              <p class="num text-base font-bold sm:text-xl" :class="(d.savingsRate ?? 0) < 0 ? 'text-rose-600' : ''">{{ d.savingsRate === null ? '—' : `${d.savingsRate}%` }}</p>
            </div>
          </div>
          <p class="mt-2 text-xs text-slate-400">轉帳、繳卡費不算收支；未來日期的交易不算</p>
        </section>

        <div class="mb-4 grid gap-4 sm:grid-cols-2">
          <section class="card p-5">
            <h3 class="text-sm text-slate-500">帳戶合計</h3>
            <p class="num mt-1 text-2xl font-bold">{{ formatMoney(d.accountsTotal) }}</p>
            <p class="mt-1 text-xs text-slate-400">啟用帳戶加總（含投資、信用卡欠款），不扣貸款</p>
          </section>
          <section class="card p-5">
            <h3 class="text-sm text-slate-500">淨資產</h3>
            <p class="num mt-1 text-2xl font-bold" :class="toCents(d.netWorth) < 0 ? 'text-rose-600' : ''">{{ formatMoney(d.netWorth) }}</p>
            <p class="mt-1 text-xs text-slate-400">所有帳戶 − 還款中貸款</p>
          </section>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <section class="card p-5">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">14 天內與逾期帳單</h3>
              <NuxtLink to="/bills" class="text-sm font-semibold text-brand-700">全部 →</NuxtLink>
            </div>
            <div v-if="unavailable('bills')" class="py-6 text-center text-sm text-slate-400">準備中</div>
            <p v-else-if="!d.billsOverdue.length && !d.billsDueSoon.length" class="mt-3 text-sm text-slate-500">沒有近期帳單</p>
            <ul v-else class="mt-3 divide-y divide-slate-100">
              <li v-for="b in [...d.billsOverdue, ...d.billsDueSoon]" :key="b.id" class="flex items-center justify-between py-2 text-sm">
                <span>{{ b.name }} <span class="text-xs" :class="b.daysUntilDue < 0 ? 'text-rose-600' : 'text-slate-500'">· {{ relativeDue(b.daysUntilDue) }}</span></span>
                <span class="num font-semibold">{{ formatMoney(b.amount) }}</span>
              </li>
            </ul>
          </section>

          <section class="card p-5">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">貸款</h3>
              <NuxtLink to="/loans" class="text-sm font-semibold text-brand-700">全部 →</NuxtLink>
            </div>
            <div v-if="unavailable('loans') || !d.loans" class="py-6 text-center text-sm text-slate-400">準備中</div>
            <template v-else>
              <p class="mt-2 text-xs text-slate-500">未償餘額合計（{{ d.loans.activeCount }} 筆還款中）</p>
              <p class="num text-xl font-bold">{{ formatMoney(d.loans.outstandingTotal) }}</p>
              <p class="mt-3 text-xs font-semibold text-slate-500">未來 14 天的還款日</p>
              <p v-if="!d.loans.upcomingPayments.length" class="text-sm text-slate-500">沒有</p>
              <ul v-else class="text-sm">
                <li v-for="p in d.loans.upcomingPayments" :key="p.loanId" class="flex justify-between py-1">
                  <span>{{ p.name }} · {{ formatDateShort(p.date) }}</span><span class="num font-semibold">{{ formatMoney(p.monthlyPayment) }}</span>
                </li>
              </ul>
            </template>
          </section>
        </div>
      </template>
    </StateView>

    <div class="h-4" />
  </div>
</template>
