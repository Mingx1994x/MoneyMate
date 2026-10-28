<script setup lang="ts">
/**
 * 貸款頁（B）— PRD §17、§15.8
 * 未償餘額、每月還款、繳款日、「餘額最後更新：X 天前」（超過 45 天提醒）。
 * 還款不會自動扣未償餘額，請使用者每月手動更新。
 */
import { errorText } from '~/lib/api-error'
import { daysSince, formatDate } from '~/lib/date'
import { formatMoney } from '~/lib/money'
import type { DashboardSummary, ListResponse, Loan } from '~/types/api'

const api = useApi()
const toast = useToast()
const { confirm } = useConfirm()
const { bump } = useDataVersion()

const loans = useResource(() => api.get<ListResponse<Loan>>('/loans').then((r) => r.items))
const summary = useResource(() => api.get<DashboardSummary>('/dashboard/summary'))
const sorted = computed(() => [...(loans.data.value ?? [])].sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1)))

const editing = ref<Loan | 'new' | null>(null)
const formOpen = computed({ get: () => editing.value !== null, set: (v) => !v && (editing.value = null) })

const staleDays = (l: Loan) => daysSince(l.balanceUpdatedAt)

async function remove(l: Loan) {
  const ok = await confirm({ title: `刪除「${l.name}」？`, message: '只會刪除貸款資料，不會刪除相關的帳單或已記的還款支出。', confirmText: '刪除', danger: true })
  if (!ok) return
  try {
    await api.del(`/loans/${l.id}`)
    toast.success('已刪除')
    bump()
  } catch (e) {
    toast.error(errorText(e))
  }
}
</script>

<template>
  <div>
    <PageHeader title="貸款" description="記錄貸款餘額與每月還款，Dashboard 會提醒近期的繳款日。">
      <template #actions>
        <AppButton @click="editing = 'new'">＋ 新增貸款</AppButton>
      </template>
    </PageHeader>

    <div class="mb-5 grid gap-3 sm:grid-cols-2">
      <div class="card p-4">
        <p class="text-sm text-slate-500">還款中的未償餘額合計</p>
        <p class="num mt-1 text-2xl font-bold">{{ summary.data.value?.loans ? formatMoney(summary.data.value.loans.outstandingTotal) : '…' }}</p>
      </div>
      <div class="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <p class="font-semibold">還款不會自動扣未償餘額</p>
        <p class="mt-1">每月還款請用「快速記帳」記成「貸款還款」支出；貸款餘額請每月手動更新一次。</p>
      </div>
    </div>

    <StateView
      :loading="loans.loading.value"
      :error="loans.error.value"
      :has-data="!!loans.data.value"
      :empty="sorted.length === 0"
      empty-title="還沒有貸款紀錄"
      empty-text="有房貸、車貸、信貸或學貸的話可以記在這裡"
      @retry="loans.reload"
    >
      <template #empty-action><AppButton variant="secondary" @click="editing = 'new'">新增貸款</AppButton></template>
      <div class="grid gap-3 lg:grid-cols-2">
        <article v-for="l in sorted" :key="l.id" class="card p-5" :class="{ 'opacity-60': l.status === 'closed' }">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-1.5">
                <h2 class="font-semibold text-slate-900">{{ l.name }}</h2>
                <AppBadge :tone="l.status === 'active' ? 'blue' : 'gray'">{{ l.status === 'active' ? '還款中' : '已結清' }}</AppBadge>
              </div>
              <p class="text-xs text-slate-500">{{ l.loanType }}{{ l.interestRate ? ` · 年利率 ${l.interestRate}%` : '' }}{{ l.note ? ` · ${l.note}` : '' }}</p>
            </div>
            <div class="flex gap-1">
              <AppButton size="sm" variant="ghost" @click="editing = l">編輯</AppButton>
              <AppButton size="sm" variant="ghost" class="text-rose-600" @click="remove(l)">刪除</AppButton>
            </div>
          </div>

          <p class="mt-3 text-xs text-slate-500">未償餘額</p>
          <p class="num text-2xl font-bold">{{ formatMoney(l.outstandingBalance) }}</p>

          <dl class="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><dt class="text-xs text-slate-500">每月還款</dt><dd class="num font-semibold">{{ formatMoney(l.monthlyPayment) }}</dd></div>
            <div><dt class="text-xs text-slate-500">繳款日</dt><dd class="font-semibold">每月 {{ l.paymentDay }} 號</dd></div>
            <div><dt class="text-xs text-slate-500">結清日</dt><dd class="num font-semibold">{{ formatDate(l.endDate) }}</dd></div>
          </dl>

          <div
            v-if="l.status === 'active'"
            class="mt-4 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm"
            :class="staleDays(l) > 45 ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600'"
          >
            <span>
              餘額最後更新：{{ staleDays(l) === 0 ? '今天' : `${staleDays(l)} 天前` }}
              <template v-if="staleDays(l) > 45"> · 該更新一下了</template>
            </span>
            <AppButton size="sm" :variant="staleDays(l) > 45 ? 'primary' : 'ghost'" @click="editing = l">更新餘額</AppButton>
          </div>
        </article>
      </div>
    </StateView>

    <AppModal v-model:open="formOpen" :title="editing === 'new' ? '新增貸款' : '編輯貸款'" wide>
      <LoanForm v-if="editing" :key="editing === 'new' ? 'new' : editing.id" :initial="editing === 'new' ? null : editing" @saved="editing = null" @cancel="editing = null" />
    </AppModal>
  </div>
</template>
