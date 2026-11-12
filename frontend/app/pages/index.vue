<script setup lang="ts">
/**
 * Dashboard —— 第一屏（3 個問題＋一句下一步）由 A 負責；往下的報表區塊（收支、帳單、貸款）由 B 負責。
 * 所有數字都來自一支 API：GET /dashboard/summary（PRD FR-19）。還沒完成的區塊會列在 unavailable，顯示「準備中」。
 * ⚠️ 開發中：目前只接上 W2 最小流程需要的「本月收支」，其他區塊之後再逐一接上。
 *    原本照 mock 資料寫的版本先註解保留（script 在下方，template 留在各區塊原本的位置），對照完再刪；
 *    收支區塊已改寫完，原本的版本已刪除。
 */
import { addMonthsClamped, monthOf } from '~/lib/date'
import { formatMoney, toCents } from '~/lib/money'
import type { DashboardSummary } from '~/types/api'

const api = useApi()
const quick = useQuickAdd()
// 要看的月份（YYYY-MM）；undefined 時不帶 month，後端用台北本月。month 只影響收支區塊
const month = ref<string>()
// 拆成最上層的 ref，template 裡可以直接寫 data.income，不用 .value
const { data, loading, error, reload } = useResource(
  () => api.get<DashboardSummary>('/dashboard/summary', { month: month.value }),
  { watch: [month] },
)

// 「當月」用 API 回傳的 today（後端 ClockService 的台北今天）判斷，前端不自己取今天
const currentMonth = computed(() => (data.value ? monthOf(data.value.today) : null))
const isCurrentMonth = computed(() => !!data.value && data.value.month === currentMonth.value)
const shiftMonth = (n: number) => {
  // 以「要看的月份」為準，不用 data.month：連點時舊資料還沒更新，會少切一個月
  const base = month.value ?? currentMonth.value
  if (base) month.value = monthOf(addMonthsClamped(`${base}-01`, n))
}
const backToCurrentMonth = () => (month.value = undefined)

// 月份從 API 的 month（YYYY-MM）取；用查表不用 Date，避免時區問題
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const monthNumber = computed(() => (data.value ? Number(data.value.month.slice(5)) : null))
const monthAbbr = computed(() => (monthNumber.value ? MONTH_ABBR[monthNumber.value - 1] : ''))
// 標題與空狀態用：當月顯示「當月」，其他月份顯示「10月」
const monthLabel = computed(() => (isCurrentMonth.value ? '當月' : `${monthNumber.value}月`))

// API 沒有「這個月有沒有交易」的欄位：收入、支出都是 0 就當成還沒有收支資料（只有轉帳的月份也算）。
// 金額用 toCents 比較，不用字串比 '0.00'
const hasMonthlyRecords = computed(
  () => !!data.value && (toCents(data.value.income) !== 0 || toCents(data.value.expense) !== 0),
)

// ===== 原本的寫法（照 mock 資料寫的，暫時保留對照）=====
// import { addMonthsClamped, formatDateShort, monthOf, relativeDue, todayTaipei } from '~/lib/date'
// import { formatMoney, formatWan, toCents } from '~/lib/money'
// import type { DashboardSummary } from '~/types/api'
//
// const api = useApi()
// const { displayName } = useAuth()
//
// const r = useResource(() => api.get<DashboardSummary>('/dashboard/summary', { month: month.value }), { watch: [month] })
// const d = computed(() => r.data.value)
// const unavailable = (k: string) => d.value?.unavailable.includes(k)
//
// /** 今天要處理：逾期＋今天到期 */
// const todayBills = computed(() => [
//   ...(d.value?.billsOverdue ?? []),
//   ...(d.value?.billsDueSoon ?? []).filter((b) => b.daysUntilDue === 0),
// ])
// const nextStepTone = computed(() => {
//   const t = d.value?.nextStep.type
//   if (t === 'overdue_bills') return 'from-rose-500 to-rose-600'
//   if (t === 'funding_gap') return 'from-amber-500 to-orange-500'
//   return 'from-brand-600 to-brand-800'
// })
// const greeting = computed(() => {
//   const h = new Date().getHours()
//   return h < 11 ? '早安' : h < 18 ? '午安' : '晚安'
// })
</script>

<template>
  <div>
    <StateView :loading="loading" :error="error" :has-data="!!data" @retry="reload">
      <template v-if="data">
        <!--
        ===== 原本的第一屏（照 mock 資料寫的，暫時保留對照）=====
        HTML 註解不能巢狀，所以裡面原本的區塊註解改寫成 <!- … -> 。

        <p class="mb-3 text-sm text-slate-500">{{ greeting }}，{{ displayName }} 👋</p>
        <OwnerNote owner="A" text="第一屏（3 個問題＋一句下一步）由 A 負責，這裡是暫時版本；下方的報表區塊由 B 負責。" />

        <!- ③ 一句下一步＋1 個大數字 ->
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
          <!- ① 今天有什麼帳單要處理？ ->
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

          <!- ② 這個月的錢夠不夠用？（14 天資金缺口） ->
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
        -->

        <!-- ===== 以下報表區塊：B 負責 ===== -->
        <!-- 原本是 mt-8（和上面的第一屏隔開），第一屏還沒接上，先拿掉 -->
        <h2 class="mb-3 text-lg font-bold text-slate-900">報表</h2>

        <!-- 月收支（W2 最小流程 ④）。順序：有收支 → 顯示數字；沒有現金／銀行帳戶 → 引導建立帳戶；都沒有 → 尚未有收支資料 -->
        <section class="card mb-4 p-5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold">{{ monthLabel }}收支</h3>
              <AppBadge>{{ monthAbbr }}</AppBadge>
              <AppButton v-if="!isCurrentMonth" size="sm" variant="soft" @click="backToCurrentMonth">回到當月</AppButton>
            </div>
            <div class="flex items-center gap-1">
              <AppButton size="sm" variant="ghost" aria-label="上個月" @click="shiftMonth(-1)">‹</AppButton>
              <span class="num text-sm text-slate-600">{{ data.month }}</span>
              <AppButton size="sm" variant="ghost" aria-label="下個月" :disabled="isCurrentMonth" @click="shiftMonth(1)">›</AppButton>
            </div>
          </div>
          <div v-if="!hasMonthlyRecords && !data.hasCashAccounts" class="py-6 text-center">
            <p class="text-sm text-slate-500">還沒有現金或銀行帳戶，先建立一個帳戶再開始記帳</p>
            <NuxtLink to="/accounts?new=1" class="mt-3 inline-block"><AppButton variant="secondary">前往建立帳戶</AppButton></NuxtLink>
          </div>
          <div v-else-if="!hasMonthlyRecords" class="py-6 text-center">
            <p class="text-sm text-slate-500">{{ monthLabel }}尚未有收支資料</p>
            <!-- 快速記帳預設記在今天，看其他月份時按了也不會記到那個月，所以只在當月顯示 -->
            <AppButton v-if="isCurrentMonth" class="mt-3" @click="quick.open()">＋ 快速記帳</AppButton>
          </div>
          <div v-else class="mt-3 grid grid-cols-3 gap-3">
            <div><p class="text-xs text-slate-500">收入</p><p class="num text-base font-bold text-emerald-700 sm:text-xl">{{ formatMoney(data.income) }}</p></div>
            <div><p class="text-xs text-slate-500">支出</p><p class="num text-base font-bold sm:text-xl">{{ formatMoney(data.expense) }}</p></div>
            <div>
              <p class="text-xs text-slate-500">儲蓄率</p>
              <p class="num text-base font-bold sm:text-xl" :class="(data.savingsRate ?? 0) < 0 ? 'text-rose-600' : ''">{{ data.savingsRate === null ? '—' : `${data.savingsRate}%` }}</p>
            </div>
          </div>
          <p v-if="hasMonthlyRecords" class="mt-2 text-xs text-slate-400">轉帳、繳卡費不算收支；未來日期的交易不算</p>
        </section>

        <!--
        ===== 原本的其他報表區塊（照 mock 資料寫的，暫時保留對照）=====

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
        -->
      </template>
    </StateView>

    <div class="h-4" />
  </div>
</template>
