<script setup lang="ts">
/**
 * 帳戶頁（B）— PRD §17、§15.9、§15.10
 * - 目前餘額由後端計算（currentBalance）；舊的估計帳戶標示「估計」
 * - 有交易只顯示「停用」，沒交易才顯示「刪除」；估計帳戶也可以刪除（D-D-004）。被帳單用到的帳戶後端回 ACCOUNT_IN_USE
 * - 「從估計值扣除」先拿掉（11/15 會議；問卷也不再建立估計帳戶，D-D-004），之後需要再加回來：
 *   新增時不帶 deductFromEstimate（後端預設 false），刪除時不帶 addBackToEstimate
 */
import { errorText } from '~/lib/api-error'
import { formatMoney, toCents } from '~/lib/money'
import type { Account, DashboardSummary, ListResponse, UpdateAccountBody } from '~/types/api'
import { ACCOUNT_TYPE_ICON, ACCOUNT_TYPE_LABEL } from '~/utils/labels'

const api = useApi()
const toast = useToast()
const { confirm } = useConfirm()
const { bump } = useDataVersion()
const quick = useQuickAdd()
const route = useRoute()
const router = useRouter()

const showInactive = ref(false)
const list = useResource(() => api.get<ListResponse<Account>>('/accounts', { includeInactive: true }).then((r) => r.items))
const summary = useResource(() => api.get<DashboardSummary>('/dashboard/summary'))

const visible = computed(() => (list.data.value ?? []).filter((a) => showInactive.value || a.isActive))
const inactiveCount = computed(() => (list.data.value ?? []).filter((a) => !a.isActive).length)

// ---------- 新增／編輯 ----------
const editing = ref<Account | 'new' | null>(null)
const formOpen = computed({ get: () => editing.value !== null, set: (v) => !v && (editing.value = null) })
/** 從快速記帳的引導進來（`?new=1&type=credit_card`）時預選的帳戶類型 */
const newType = ref<Account['accountType'] | undefined>()
// 用 watch 不用 onMounted：已經在帳戶頁時，從快速記帳的引導按鈕進來，頁面不會重新載入
watch(
  () => route.query.new,
  (v) => {
    if (!v) return
    const t = route.query.type
    newType.value = typeof t === 'string' && t in ACCOUNT_TYPE_LABEL ? (t as Account['accountType']) : undefined
    editing.value = 'new'
    router.replace({ query: {} })
  },
  { immediate: true },
)

async function save(values: { name: string; accountType: Account['accountType']; openingBalance: string; note?: string | null }) {
  if (editing.value === 'new') {
    await api.post<Account>('/accounts', values)
    toast.success('帳戶已建立')
  } else if (editing.value) {
    // 帳戶類型不能改：後端 UpdateAccountDto 沒有 accountType，帶了會回 400
    const body: UpdateAccountBody = { name: values.name, openingBalance: values.openingBalance, note: values.note }
    await api.patch<Account>(`/accounts/${editing.value.id}`, body)
    toast.success('帳戶已更新')
  }
  editing.value = null
  bump()
}

// ---------- 停用／啟用／刪除 ----------
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

async function toggleActive(a: Account) {
  if (a.isActive) {
    if (toCents(a.currentBalance) !== 0) {
      toast.error(`「${a.name}」餘額還有 ${formatMoney(a.currentBalance)}，要先變成 0 才能停用`)
      return
    }
    const ok = await confirm({ title: `停用「${a.name}」？`, message: '停用後歷史交易都還在，但不能再用這個帳戶記帳或修改相關交易。之後可以重新啟用。', confirmText: '停用' })
    if (ok) await run(a.id, () => api.patch(`/accounts/${a.id}`, { isActive: false }), '已停用')
  } else {
    await run(a.id, () => api.patch(`/accounts/${a.id}`, { isActive: true }), '已重新啟用')
  }
}

async function remove(a: Account) {
  const ok = await confirm({ title: `刪除「${a.name}」？`, message: '這個帳戶沒有任何交易，刪除後無法復原。', confirmText: '刪除', danger: true })
  if (ok) await run(a.id, () => api.del(`/accounts/${a.id}`), '已刪除')
}

function balanceNote(a: Account) {
  const c = toCents(a.currentBalance)
  if (a.accountType !== 'credit_card') return null
  if (c < 0) return { text: `欠款 ${formatMoney(-c / 100)}`, cls: 'text-rose-600' }
  if (c > 0) return { text: `溢繳 ${formatMoney(c / 100)}`, cls: 'text-emerald-700' }
  return { text: '已繳清', cls: 'text-slate-500' }
}
</script>

<template>
  <div>
    <PageHeader title="帳戶" description="餘額由系統依交易自動計算。">
      <template #actions>
        <AppButton @click="newType = undefined; editing = 'new'">＋ 新增帳戶</AppButton>
      </template>
    </PageHeader>

    <!-- 帳戶合計與淨資產分開標示（數字來自後端） -->
    <div class="mb-5 grid gap-3 sm:grid-cols-2">
      <div class="card p-4">
        <p class="text-sm text-slate-500">帳戶合計</p>
        <p class="num mt-1 text-2xl font-bold">{{ summary.data.value ? formatMoney(summary.data.value.accountsTotal) : '…' }}</p>
        <p class="mt-1 text-xs text-slate-500">啟用帳戶的餘額加總，含投資與信用卡欠款、不扣貸款</p>
      </div>
      <div class="card p-4">
        <p class="text-sm text-slate-500">淨資產</p>
        <p class="num mt-1 text-2xl font-bold">{{ !summary.data.value ? '…' : summary.data.value.netWorth === null ? '準備中' : formatMoney(summary.data.value.netWorth) }}</p>
        <p class="mt-1 text-xs text-slate-500">所有帳戶餘額 − 還款中貸款的未償餘額</p>
      </div>
    </div>

    <div class="card overflow-hidden">
      <StateView
        :loading="list.loading.value"
        :error="list.error.value"
        :has-data="!!list.data.value"
        :empty="visible.length === 0"
        empty-title="還沒有帳戶"
        empty-text="先建立一個帳戶，例如你的錢包或薪轉帳戶"
        @retry="list.reload"
      >
        <template #empty-action><AppButton @click="newType = undefined; editing = 'new'">新增帳戶</AppButton></template>
        <ul class="divide-y divide-slate-100">
          <li v-for="a in visible" :key="a.id" class="flex flex-wrap items-center gap-3 px-4 py-4 sm:flex-nowrap" :class="{ 'opacity-60': !a.isActive }">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl">{{ ACCOUNT_TYPE_ICON[a.accountType] }}</div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-semibold text-slate-900">{{ a.name }}</span>
                <AppBadge v-if="a.isEstimate" tone="violet">估計</AppBadge>
                <AppBadge v-if="!a.isActive">已停用</AppBadge>
              </div>
              <p class="truncate text-xs text-slate-500">
                {{ a.isEstimate ? '問卷填的存款（估計），可以直接修改金額' : ACCOUNT_TYPE_LABEL[a.accountType] }}{{ a.note && !a.isEstimate ? ` · ${a.note}` : '' }}
              </p>
            </div>
            <div class="ml-auto text-right">
              <p class="num text-lg font-bold" :class="toCents(a.currentBalance) < 0 ? 'text-rose-600' : 'text-slate-900'">{{ formatMoney(a.currentBalance) }}</p>
              <p v-if="balanceNote(a)" class="text-xs" :class="balanceNote(a)!.cls">{{ balanceNote(a)!.text }}</p>
            </div>
            <div class="flex w-full justify-end gap-1 sm:w-auto">
              <AppButton v-if="a.accountType === 'credit_card' && a.isActive" size="sm" variant="soft" @click="quick.open('card', a.id)">繳卡費</AppButton>
              <AppButton v-if="a.isActive" size="sm" variant="ghost" @click="editing = a">編輯</AppButton>
              <AppButton size="sm" variant="ghost" :loading="busy === a.id" @click="toggleActive(a)">{{ a.isActive ? '停用' : '啟用' }}</AppButton>
              <!-- 有交易只能停用，沒有交易才顯示刪除（§17） -->
              <AppButton v-if="!a.hasTransactions" size="sm" variant="ghost" class="text-rose-600" @click="remove(a)">刪除</AppButton>
            </div>
          </li>
        </ul>
      </StateView>
    </div>

    <label v-if="inactiveCount > 0" class="mt-3 flex items-center gap-2 text-sm text-slate-600">
      <input v-model="showInactive" type="checkbox" class="h-4 w-4 accent-brand-700">
      顯示已停用的帳戶（{{ inactiveCount }}）
    </label>

    <AppModal v-model:open="formOpen" :title="editing === 'new' ? '新增帳戶' : '編輯帳戶'">
      <AccountForm
        v-if="editing"
        :key="editing === 'new' ? 'new' : editing.id"
        :initial="editing === 'new' ? null : editing"
        :default-type="editing === 'new' ? newType : undefined"
        :save="save"
        @cancel="editing = null"
      />
    </AppModal>
  </div>
</template>
