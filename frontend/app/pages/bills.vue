<script setup lang="ts">
/**
 * 帳單頁（B）— PRD §16、§17
 * 待繳／已繳／逾期；繳費、取消繳費、停止重複。逾期＝待繳且到期日 < 今天（不另存狀態）。
 * 語氣：提醒而非責備。
 */
import { errorText } from '~/lib/api-error'
import { diffDays, formatDate, relativeDue, todayTaipei } from '~/lib/date'
import { formatMoney, normalizeAmount, validateAmount } from '~/lib/money'
import type { Bill, ListResponse } from '~/types/api'
import { CATEGORY_ICON, RECURRENCE_LABEL } from '~/utils/labels'

const api = useApi()
const toast = useToast()
const { confirm } = useConfirm()
const { bump } = useDataVersion()
const route = useRoute()
const router = useRouter()
const { accountName, categories, accounts } = useLookups()
const today = todayTaipei()

const bills = useResource(() => api.get<ListResponse<Bill>>('/bills').then((r) => r.items))
const all = computed(() => bills.data.value ?? [])

type Tab = 'pending' | 'paid' | 'all'
const tab = ref<Tab>('pending')
const TABS = [
  { value: 'pending' as Tab, label: '待繳' },
  { value: 'paid' as Tab, label: '已繳' },
  { value: 'all' as Tab, label: '全部' },
]

const days = (b: Bill) => diffDays(today, b.dueDate)
const overdue = computed(() => all.value.filter((b) => b.status === 'pending' && days(b) < 0))
const dueSoon = computed(() => all.value.filter((b) => b.status === 'pending' && days(b) >= 0 && days(b) <= 14))
const visible = computed(() => {
  const list = all.value.filter((b) => tab.value === 'all' || b.status === tab.value)
  return tab.value === 'paid' ? [...list].sort((a, b) => b.dueDate.localeCompare(a.dueDate)) : list
})
/** 同系列還有「會重複的待繳帳單」才顯示停止重複 */
const seriesRecurring = computed(() => new Set(all.value.filter((b) => b.status === 'pending' && b.recurrence !== 'none').map((b) => b.seriesId)))
const categoryCode = (id: string) => (categories.data.value ?? []).find((c) => c.id === id)?.code ?? ''

function statusBadge(b: Bill): { tone: 'green' | 'red' | 'amber' | 'gray'; text: string } {
  if (b.status === 'paid') return { tone: 'green', text: '已繳' }
  const d = days(b)
  if (d < 0) return { tone: 'red', text: relativeDue(d) }
  if (d <= 3) return { tone: 'amber', text: relativeDue(d) }
  return { tone: 'gray', text: relativeDue(d) }
}

// ---------- 新增／編輯 ----------
const editing = ref<Bill | 'new' | null>(null)
const formOpen = computed({ get: () => editing.value !== null, set: (v) => !v && (editing.value = null) })

// ---------- 繳費 ----------
const paying = ref<Bill | null>(null)
const payOpen = computed({ get: () => paying.value !== null, set: (v) => !v && (paying.value = null) })
const payForm = ref({ paidAmount: '', paidDate: today })
const payErrors = ref<Record<string, string | undefined>>({})
const payError = ref<string | null>(null)
const paySaving = ref(false)

function openPay(b: Bill) {
  paying.value = b
  payForm.value = { paidAmount: String(Number(b.amount)), paidDate: today }
  payErrors.value = {}
  payError.value = null
}

async function submitPay() {
  if (!paying.value || paySaving.value) return
  payErrors.value = {
    paidAmount: validateAmount(payForm.value.paidAmount),
    paidDate: !payForm.value.paidDate ? '請選擇繳費日期' : payForm.value.paidDate > today ? '繳費日期不能晚於今天' : undefined,
  }
  if (Object.values(payErrors.value).some(Boolean)) return
  paySaving.value = true // 按下後鎖住按鈕；後端才是真正的防護
  payError.value = null
  try {
    const b = paying.value
    await api.post(`/bills/${b.id}/pay`, { paidAmount: normalizeAmount(payForm.value.paidAmount), paidDate: payForm.value.paidDate })
    toast.success(`已繳「${b.name}」${b.recurrence !== 'none' ? '，下一期已自動建立' : ''}`)
    paying.value = null
    bump()
  } catch (e) {
    payError.value = errorText(e)
  } finally {
    paySaving.value = false
  }
}

// Dashboard「去繳費」會帶 ?pay=<id>
watch(
  () => [bills.data.value, route.query.pay] as const,
  ([data, payId]) => {
    if (!data || !payId) return
    const b = data.find((x) => x.id === payId && x.status === 'pending')
    if (b) openPay(b)
    router.replace({ query: {} })
  },
)

// ---------- 取消繳費／停止重複／刪除 ----------
const busy = ref<string | null>(null)
async function run(id: string, fn: () => Promise<unknown>, okText: string) {
  busy.value = id
  try {
    await fn()
    toast.success(okText)
    bump()
  } catch (e) {
    toast.error(errorText(e))
  } finally {
    busy.value = null
  }
}

async function unpay(b: Bill) {
  const ok = await confirm({
    title: `取消「${b.name}」的繳費？`,
    message: `會刪除這次繳費產生的支出 ${formatMoney(b.paidAmount)}，帳單改回待繳。` + (b.recurrence !== 'none' ? '\n已經自動產生、還沒繳的下一期也會一起刪掉。' : ''),
    confirmText: '取消繳費',
  })
  if (ok) await run(b.id, () => api.post(`/bills/${b.id}/unpay`), '已取消繳費')
}

const stopping = ref<Bill | null>(null)
const stopOpen = computed({ get: () => stopping.value !== null, set: (v) => !v && (stopping.value = null) })
async function stop(keepCurrent: boolean) {
  const b = stopping.value!
  stopping.value = null
  await run(b.id, () => api.post(`/bills/${b.id}/stop-recurrence`, { keepCurrent }), keepCurrent ? '已停止重複，這期繳完就不會再產生' : '已停止重複，並刪除這期')
}

async function remove(b: Bill) {
  const ok = await confirm({
    title: `刪除「${b.name}」？`,
    message: b.recurrence !== 'none' ? '刪除後這個系列就不會再產生下一期（等於停止重複），已繳的歷史帳單會保留。' : '刪除後無法復原。',
    confirmText: '刪除',
    danger: true,
  })
  if (ok) await run(b.id, () => api.del(`/bills/${b.id}`), '已刪除')
}

const pendingOfStopping = computed(() =>
  stopping.value ? all.value.find((x) => x.seriesId === stopping.value!.seriesId && x.status === 'pending') : undefined,
)
</script>

<template>
  <div>
    <PageHeader title="帳單" description="固定支出建成帳單，繳費後自動記一筆支出，重複的帳單會自動產生下一期。">
      <template #actions>
        <AppButton @click="editing = 'new'">＋ 新增帳單</AppButton>
      </template>
    </PageHeader>

    <!-- 提醒（不責備） -->
    <div v-if="overdue.length || dueSoon.length" class="mb-5 grid gap-3 sm:grid-cols-2">
      <div v-if="overdue.length" class="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <p class="font-semibold text-rose-800">有 {{ overdue.length }} 張帳單過了到期日</p>
        <p class="mt-0.5 text-sm text-rose-700">{{ overdue.map((b) => b.name).join('、') }} — 繳了之後記得按「繳費」</p>
      </div>
      <div v-if="dueSoon.length" class="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p class="font-semibold text-amber-900">14 天內有 {{ dueSoon.length }} 張帳單到期</p>
        <p class="mt-0.5 text-sm text-amber-800">合計 {{ formatMoney(dueSoon.reduce((s, b) => s + Number(b.amount), 0)) }}</p>
      </div>
    </div>

    <div class="mb-3 max-w-xs"><Segmented v-model="tab" :options="TABS" label="帳單狀態" /></div>

    <div class="card overflow-hidden">
      <StateView
        :loading="bills.loading.value"
        :error="bills.error.value"
        :has-data="!!bills.data.value"
        :empty="visible.length === 0"
        :empty-title="tab === 'pending' ? '沒有待繳帳單 🎉' : '還沒有帳單'"
        :empty-text="tab === 'pending' ? '目前沒有需要處理的帳單' : '把電費、房租、訂閱這類固定支出建成帳單，就不怕忘記繳'"
        @retry="bills.reload"
      >
        <template #empty-action><AppButton variant="secondary" @click="editing = 'new'">新增帳單</AppButton></template>
        <ul class="divide-y divide-slate-100">
          <li v-for="b in visible" :key="b.id" class="flex flex-wrap items-center gap-3 px-4 py-4 sm:flex-nowrap">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl">{{ CATEGORY_ICON[categoryCode(b.categoryId)] ?? '🧾' }}</div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-semibold text-slate-900">{{ b.name }}</span>
                <AppBadge :tone="statusBadge(b).tone">{{ statusBadge(b).text }}</AppBadge>
                <AppBadge v-if="b.recurrence !== 'none'" tone="blue">{{ RECURRENCE_LABEL[b.recurrence] }}</AppBadge>
              </div>
              <p class="text-xs text-slate-500">
                到期 {{ formatDate(b.dueDate) }} · {{ accounts.data.value ? accountName(b.accountId) : '' }}
                <template v-if="b.status === 'paid'"> · {{ formatDate(b.paidDate) }} 實繳 {{ formatMoney(b.paidAmount) }}</template>
                <template v-if="b.note"> · {{ b.note }}</template>
              </p>
            </div>
            <p class="num ml-auto text-lg font-bold">{{ formatMoney(b.amount) }}</p>
            <div class="flex w-full flex-wrap justify-end gap-1 sm:w-auto sm:flex-nowrap">
              <template v-if="b.status === 'pending'">
                <AppButton size="sm" @click="openPay(b)">繳費</AppButton>
                <AppButton size="sm" variant="ghost" @click="editing = b">編輯</AppButton>
                <AppButton v-if="b.recurrence !== 'none'" size="sm" variant="ghost" @click="stopping = b">停止重複</AppButton>
                <AppButton size="sm" variant="ghost" class="text-rose-600" :loading="busy === b.id" @click="remove(b)">刪除</AppButton>
              </template>
              <template v-else>
                <AppButton size="sm" variant="ghost" :loading="busy === b.id" @click="unpay(b)">取消繳費</AppButton>
                <AppButton size="sm" variant="ghost" @click="editing = b">編輯</AppButton>
                <AppButton v-if="seriesRecurring.has(b.seriesId)" size="sm" variant="ghost" @click="stopping = b">停止重複</AppButton>
              </template>
            </div>
          </li>
        </ul>
      </StateView>
    </div>

    <!-- 新增／編輯 -->
    <AppModal v-model:open="formOpen" :title="editing === 'new' ? '新增帳單' : '編輯帳單'">
      <BillForm v-if="editing" :key="editing === 'new' ? 'new' : editing.id" :initial="editing === 'new' ? null : editing" @saved="editing = null" @cancel="editing = null" />
    </AppModal>

    <!-- 繳費 -->
    <AppModal v-model:open="payOpen" :title="`繳費：${paying?.name ?? ''}`">
      <form v-if="paying" class="space-y-4" novalidate @submit.prevent="submitPay">
        <FormError :message="payError" />
        <p class="text-sm text-slate-600">
          會從「{{ accountName(paying.accountId) }}」記一筆支出。<template v-if="paying.recurrence !== 'none'">繳完會自動建立下一期（金額沿用 {{ formatMoney(paying.amount) }}）。</template>
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppField label="實繳金額" for="pay-amount" :error="payErrors.paidAmount" required hint="跟預定金額不同也沒關係">
            <MoneyInput id="pay-amount" v-model="payForm.paidAmount" :invalid="!!payErrors.paidAmount" />
          </AppField>
          <AppField label="繳費日期" for="pay-date" :error="payErrors.paidDate" required>
            <input id="pay-date" v-model="payForm.paidDate" type="date" :max="today" class="field-input" :aria-invalid="!!payErrors.paidDate || undefined">
          </AppField>
        </div>
        <div class="flex justify-end gap-2">
          <AppButton variant="secondary" :disabled="paySaving" @click="paying = null">取消</AppButton>
          <AppButton type="submit" :loading="paySaving">確認繳費</AppButton>
        </div>
      </form>
    </AppModal>

    <!-- 停止重複 -->
    <AppModal v-model:open="stopOpen" title="停止重複">
      <div v-if="stopping" class="space-y-3">
        <p class="text-sm text-slate-600">
          「{{ stopping.name }}」之後不會再自動產生下一期。已繳的歷史帳單都會保留。
          <template v-if="pendingOfStopping">目前待繳的是 {{ formatDate(pendingOfStopping.dueDate) }} 那一期：</template>
        </p>
        <button class="card w-full p-4 text-left hover:border-brand-500" @click="stop(true)">
          <p class="font-semibold">這期還要繳</p>
          <p class="text-sm text-slate-500">保留這期，繳完之後就結束</p>
        </button>
        <button class="card w-full p-4 text-left hover:border-rose-400" @click="stop(false)">
          <p class="font-semibold">這期也不用繳了</p>
          <p class="text-sm text-slate-500">刪除這期待繳帳單，現在就結束</p>
        </button>
      </div>
    </AppModal>
  </div>
</template>
