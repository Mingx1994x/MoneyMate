<script setup lang="ts">
/**
 * Dashboard —— 第一屏（3 個問題＋一句下一步）由 A 負責；往下的報表區塊（收支、帳單、貸款）由 B 負責。
 * 所有數字都來自一支 API：GET /dashboard/summary（PRD FR-19）。還沒完成的區塊會列在 unavailable，顯示「準備中」。
 * 第一屏依 PRD 第三節、第十七節、15.5：一句下一步＋1 個大數字、今天要處理的帳單、14 天資金缺口。
 */
import { addMonthsClamped, formatDateShort, monthOf, relativeDue } from '~/lib/date'
import { formatMoney, formatWan, toCents } from '~/lib/money'
import type { DashboardSection, DashboardSummary, NextStep } from '~/types/api'

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

// ===== 帳單、貸款區塊（#87）=====
// 後端還沒完成的區塊會列在 unavailable，對應的欄位是 null，顯示「準備中」
const unavailable = (k: DashboardSection) => !!data.value?.unavailable.includes(k)
// 逾期在前（由舊到新）、再接 14 天內到期；後端各回最多 5 筆
const upcomingBills = computed(() => [...(data.value?.billsOverdue ?? []), ...(data.value?.billsDueSoon ?? [])])
const moreOverdue = computed(() => (data.value?.billsOverdueCount ?? 0) - (data.value?.billsOverdue?.length ?? 0))

// ===== 第一屏（A）=====
// ③ 一句下一步：nextStep.message 是後端組好的句子，直接顯示；amount 是句子裡的大數字（缺口、還差多少），
// 逾期、已達成、問卷三種情況是 null，只顯示句子。nextStep 是 null（bills 或 goal 區塊未完成）時顯示「準備中」
const NEXT_STEP_TONE: Record<NextStep['type'], string> = {
  overdue_bills: 'from-rose-500 to-rose-600',
  funding_gap: 'from-amber-500 to-orange-500',
  next_milestone: 'from-brand-600 to-brand-800',
  goal_achieved: 'from-brand-600 to-brand-800',
  onboarding: 'from-brand-600 to-brand-800',
}
const NEXT_STEP_ACTION: Record<NextStep['type'], { to: string; label: string }> = {
  overdue_bills: { to: '/bills', label: '去看帳單' },
  funding_gap: { to: '/bills', label: '去看帳單' },
  next_milestone: { to: '/goal', label: '看目標進度' },
  goal_achieved: { to: '/goal', label: '看目標進度' },
  onboarding: { to: '/onboarding', label: '開始問卷' },
}

// ① 今天要處理的帳單：逾期（後端由舊到新，最多 5 筆）＋今天到期（billsDueSoon 裡 daysUntilDue 是 0 的）
const todayBills = computed(() => [
  ...(data.value?.billsOverdue ?? []),
  ...(data.value?.billsDueSoon ?? []).filter((b) => b.daysUntilDue === 0),
])
</script>

<template>
  <div>
    <StateView :loading="loading" :error="error" :has-data="!!data" @retry="reload">
      <template v-if="data">
        <!-- ===== 第一屏：A 負責（PRD 第三節的 3 個問題）===== -->

        <!-- ③ 我現在只需要做哪一件事？一句下一步＋1 個大數字（15.5） -->
        <section v-if="!data.nextStep" class="card mb-4 p-6">
          <p class="text-sm font-medium text-slate-500">現在只需要做這一件事</p>
          <p class="mt-2 text-xl font-bold text-slate-400">準備中</p>
        </section>
        <section v-else class="mb-4 rounded-3xl bg-gradient-to-br p-6 text-white shadow-lg" :class="NEXT_STEP_TONE[data.nextStep.type]">
          <p class="text-sm font-medium text-white/80">現在只需要做這一件事</p>
          <p v-if="data.nextStep.amount" class="num mt-2 text-4xl font-bold tracking-tight sm:text-5xl">{{ formatMoney(data.nextStep.amount) }}</p>
          <p class="mt-2 leading-snug font-bold" :class="data.nextStep.amount ? 'text-lg sm:text-xl' : 'text-2xl sm:text-3xl'">{{ data.nextStep.message }}</p>
          <div class="mt-4">
            <NuxtLink :to="NEXT_STEP_ACTION[data.nextStep.type].to">
              <AppButton variant="secondary">{{ NEXT_STEP_ACTION[data.nextStep.type].label }}</AppButton>
            </NuxtLink>
          </div>
          <p v-if="data.goal" class="mt-3 text-xs text-white/75">
            目標進度 {{ data.goal.percent }}%（{{ formatWan(data.goal.currentAmount) }} / {{ formatWan(data.goal.targetAmount) }}）
          </p>
        </section>

        <div class="grid gap-4 md:grid-cols-2">
          <!-- ① 今天有什麼帳單要處理？逾期＋今天到期，附「去繳費」 -->
          <section class="card p-5">
            <h2 class="text-sm font-semibold text-slate-500">今天有什麼帳單要處理？</h2>
            <p v-if="unavailable('bills')" class="mt-3 text-slate-400">準備中</p>
            <p v-else-if="!todayBills.length" class="mt-3 font-semibold text-emerald-700">✓ 今天沒有要處理的帳單</p>
            <ul v-else class="mt-3 space-y-2">
              <li v-for="b in todayBills" :key="b.id" class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <div class="min-w-0">
                  <p class="truncate font-semibold">{{ b.name }} <span class="num font-normal">{{ formatMoney(b.amount) }}</span></p>
                  <p class="text-xs" :class="b.daysUntilDue < 0 ? 'text-rose-600' : 'text-amber-700'">{{ relativeDue(b.daysUntilDue) }}</p>
                </div>
                <NuxtLink :to="{ path: '/bills', query: { pay: b.id } }" class="shrink-0"><AppButton size="sm">去繳費</AppButton></NuxtLink>
              </li>
              <li v-if="moreOverdue > 0" class="text-xs text-slate-500">還有 {{ moreOverdue }} 張逾期帳單，到帳單頁查看</li>
            </ul>
          </section>

          <!-- ② 這個月的錢夠不夠用？14 天資金缺口（15.5）。fundingGap 只有缺口 > 0 才有值 -->
          <section class="card p-5">
            <h2 class="text-sm font-semibold text-slate-500">這個月的錢夠不夠用？</h2>
            <p v-if="unavailable('bills')" class="mt-3 text-slate-400">準備中</p>
            <template v-else-if="!data.hasCashAccounts">
              <p class="mt-3 text-slate-700">新增現金或銀行帳戶後，就能幫你檢查</p>
              <NuxtLink to="/accounts?new=1" class="mt-2 inline-block text-sm font-semibold text-brand-700">新增帳戶 →</NuxtLink>
            </template>
            <p v-else-if="data.fundingGap === null" class="mt-3 font-semibold text-emerald-700">✓ 14 天內的帳單付得出來</p>
            <div v-else class="mt-3">
              <p class="font-semibold text-amber-800">未來 14 天的已知帳單，整體資金可能不足</p>
              <p class="num mt-1 text-2xl font-bold text-amber-700">差 {{ formatMoney(data.fundingGap) }}</p>
            </div>
            <p v-if="!unavailable('bills') && data.hasCashAccounts" class="mt-2 text-xs text-slate-500">
              可用現金（現金＋銀行）{{ formatMoney(data.availableCash) }}；不含投資、信用卡與估計帳戶
            </p>
          </section>
        </div>

        <!-- ===== 以下報表區塊：B 負責 ===== -->
        <h2 class="mt-8 mb-3 text-lg font-bold text-slate-900">報表</h2>

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

        <!-- 帳戶合計、淨資產。淨資產要扣貸款，貸款區塊還沒完成時後端回 null -->
        <div class="mb-4 grid gap-4 sm:grid-cols-2">
          <section class="card p-5">
            <h3 class="text-sm text-slate-500">帳戶合計</h3>
            <p class="num mt-1 text-2xl font-bold" :class="toCents(data.accountsTotal) < 0 ? 'text-rose-600' : ''">{{ formatMoney(data.accountsTotal) }}</p>
            <p class="mt-1 text-xs text-slate-400">啟用帳戶加總（含投資、信用卡欠款），不扣貸款</p>
          </section>
          <section class="card p-5">
            <h3 class="text-sm text-slate-500">淨資產</h3>
            <p v-if="data.netWorth === null" class="mt-1 text-2xl font-bold text-slate-400">準備中</p>
            <p v-else class="num mt-1 text-2xl font-bold" :class="toCents(data.netWorth) < 0 ? 'text-rose-600' : ''">{{ formatMoney(data.netWorth) }}</p>
            <p class="mt-1 text-xs text-slate-400">所有帳戶 − 還款中貸款</p>
          </section>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <!-- 帳單：逾期＋14 天內到期 -->
          <section class="card p-5">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">14 天內與逾期帳單</h3>
              <NuxtLink to="/bills" class="text-sm font-semibold text-brand-700">全部 →</NuxtLink>
            </div>
            <div v-if="unavailable('bills')" class="py-6 text-center text-sm text-slate-400">準備中</div>
            <div v-else-if="!upcomingBills.length" class="py-6 text-center">
              <p class="text-sm text-slate-500">近 14 天沒有要繳的帳單</p>
              <NuxtLink to="/bills" class="mt-2 inline-block text-sm font-semibold text-brand-700">管理帳單 →</NuxtLink>
            </div>
            <ul v-else class="mt-3 divide-y divide-slate-100">
              <li v-for="b in upcomingBills" :key="b.id" class="flex items-center justify-between gap-2 py-2 text-sm">
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ b.name }}</p>
                  <p class="text-xs" :class="b.daysUntilDue < 0 ? 'text-rose-600' : b.daysUntilDue <= 3 ? 'text-amber-700' : 'text-slate-500'">
                    {{ formatDateShort(b.dueDate) }} · {{ relativeDue(b.daysUntilDue) }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="num font-semibold">{{ formatMoney(b.amount) }}</span>
                  <NuxtLink :to="{ path: '/bills', query: { pay: b.id } }"><AppButton size="sm" variant="soft">繳費</AppButton></NuxtLink>
                </div>
              </li>
              <li v-if="moreOverdue > 0" class="pt-2 text-xs text-slate-500">還有 {{ moreOverdue }} 張逾期帳單，到帳單頁查看</li>
            </ul>
          </section>

          <!-- 貸款：未償餘額合計＋14 天內的還款日 -->
          <section class="card p-5">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">貸款</h3>
              <NuxtLink to="/loans" class="text-sm font-semibold text-brand-700">全部 →</NuxtLink>
            </div>
            <div v-if="unavailable('loans') || !data.loans" class="py-6 text-center text-sm text-slate-400">準備中</div>
            <div v-else-if="data.loans.activeCount === 0" class="py-6 text-center">
              <p class="text-sm text-slate-500">沒有還款中的貸款</p>
              <NuxtLink to="/loans" class="mt-2 inline-block text-sm font-semibold text-brand-700">新增貸款 →</NuxtLink>
            </div>
            <template v-else>
              <p class="mt-2 text-xs text-slate-500">未償餘額合計（{{ data.loans.activeCount }} 筆還款中）</p>
              <p class="num text-xl font-bold">{{ formatMoney(data.loans.outstandingTotal) }}</p>
              <p class="mt-3 text-xs font-semibold text-slate-500">未來 14 天的還款日</p>
              <p v-if="!data.loans.upcomingPayments.length" class="text-sm text-slate-500">沒有</p>
              <ul v-else class="text-sm">
                <li v-for="p in data.loans.upcomingPayments" :key="`${p.loanId}-${p.date}`" class="flex justify-between py-1">
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
