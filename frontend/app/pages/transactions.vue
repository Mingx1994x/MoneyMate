<script setup lang="ts">
/**
 * 交易列表頁 —— PRD §20.1、§20.4：由 C 負責（篩選邏輯和 C 的 API 綁最緊），A 審查。
 * 以 B 的暫時版本為基礎；記帳表單（TransactionForm）是 B 的共用元件。
 * - 篩選：日期、類型、分類、帳戶（FR-11、AC-07）；分頁 20 筆
 * - 版面（D-A-010）：類型用分頁標籤；分類、帳戶放上方；起日、迄日收進「進階篩選」，有日期條件時按鈕上有數字、收合時顯示日期摘要
 * - 篩選條件與頁碼放在網址上，重新整理、分享連結都保留
 * - 帳單產生的交易隱藏修改／刪除（§16.5）；轉出或轉入帳戶已停用的交易也隱藏（§15.11、AC-26）
 */
import { errorText } from '~/lib/api-error'
import { formatDate, todayTaipei } from '~/lib/date'
import { formatMoney } from '~/lib/money'
import type { Paginated, Transaction, TransactionType } from '~/types/api'
import { CATEGORY_ICON, TX_TYPE_LABEL } from '~/utils/labels'

const api = useApi()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const { bump } = useDataVersion()
const quick = useQuickAdd()
const { accounts, categories, accountName, categoryName } = useLookups()

// ---------- 篩選與頁碼（參數名稱與 C 的後端一致：dateFrom、dateTo、transactionType） ----------
type Filters = { dateFrom: string; dateTo: string; transactionType: '' | TransactionType; categoryId: string; accountId: string }
const EMPTY_FILTERS: Filters = { dateFrom: '', dateTo: '', transactionType: '', categoryId: '', accountId: '' }
const PAGE_SIZE = 20
const today = todayTaipei()

/** 從網址讀回篩選條件：格式不對的值直接忽略，不讓整頁變成錯誤畫面 */
function fromQuery(): { filters: Filters; page: number } {
  const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '')
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')
  const id = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : '')
  const type = q('transactionType')
  const n = Number(q('page'))
  return {
    filters: {
      dateFrom: date(q('dateFrom')),
      dateTo: date(q('dateTo')),
      transactionType: type === 'income' || type === 'expense' || type === 'transfer' ? type : '',
      categoryId: id(q('categoryId')),
      accountId: id(q('accountId')),
    },
    page: Number.isInteger(n) && n > 1 ? n : 1,
  }
}
const initial = fromQuery()
const filters = ref<Filters>(initial.filters)
const page = ref(initial.page)

// 改篩選就回到第 1 頁
watch(filters, () => (page.value = 1), { deep: true })
// 篩選與頁碼寫回網址（空的不寫）；用 replace，不讓每次調整都多一筆瀏覽紀錄
watch(
  [filters, page],
  () => {
    const query: Record<string, string> = {}
    for (const [k, v] of Object.entries(filters.value)) if (v) query[k] = v
    if (page.value > 1) query.page = String(page.value)
    void router.replace({ query })
  },
  { deep: true },
)

/** 起日晚於迄日：前端先擋，不送出（後端會回 400） */
const dateRangeError = computed(() =>
  filters.value.dateFrom && filters.value.dateTo && filters.value.dateFrom > filters.value.dateTo ? '迄日不能早於起日' : null,
)

const result = useResource(
  () =>
    dateRangeError.value
      ? Promise.resolve<Paginated<Transaction>>({ items: [], page: 1, pageSize: PAGE_SIZE, total: 0 })
      : api.get<Paginated<Transaction>>('/transactions', { ...filters.value, page: page.value, pageSize: PAGE_SIZE }),
  { watch: [page, filters] },
)
const pages = computed(() => Math.max(1, Math.ceil((result.data.value?.total ?? 0) / PAGE_SIZE)))
// 刪掉最後一頁的最後一筆（或網址上的頁碼太大）：跳到最後一頁，不停在空白頁
watch(
  () => result.data.value,
  (d) => {
    if (d && d.items.length === 0 && page.value > 1) page.value = Math.max(1, Math.ceil(d.total / PAGE_SIZE))
  },
)
const filterCategories = computed(() => (categories.data.value ?? []).filter((c) => !filters.value.transactionType || c.type === filters.value.transactionType))
const hasFilter = computed(() => Object.values(filters.value).some(Boolean))
const categoryCode = (id: string | null) => (categories.data.value ?? []).find((c) => c.id === id)?.code ?? ''

/** 轉出或轉入帳戶已停用：這筆交易不能修改或刪除（§15.11、AC-26） */
const touchesInactiveAccount = (t: Transaction) =>
  (accounts.data.value ?? []).some((a) => !a.isActive && (a.id === t.accountId || a.id === t.toAccountId))
function clearFilters() {
  filters.value = { ...EMPTY_FILTERS }
}

// ---------- 類型分頁標籤（D-A-010；繳卡費也是轉帳） ----------
const TYPE_TABS: { value: '' | TransactionType; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'income', label: '收入' },
  { value: 'expense', label: '支出' },
  { value: 'transfer', label: '轉帳' },
]
/** 切換類型時清空分類：收入、支出的分類不同，轉帳沒有分類 */
function selectType(v: '' | TransactionType) {
  if (filters.value.transactionType === v) return
  filters.value.transactionType = v
  filters.value.categoryId = ''
}
const tabEls: (HTMLButtonElement | null)[] = []
/** 鍵盤操作（WAI-ARIA tabs）：左右鍵切換、Home／End 到頭尾 */
function onTabKeydown(e: KeyboardEvent, i: number) {
  const last = TYPE_TABS.length - 1
  const keyMap: Record<string, number> = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }
  const next = keyMap[e.key]
  const tab = next === undefined ? undefined : TYPE_TABS[next]
  if (next === undefined || !tab) return
  e.preventDefault()
  selectType(tab.value)
  tabEls[next]?.focus()
}

// ---------- 進階篩選（起日、迄日） ----------
const dateFilterCount = computed(() => [filters.value.dateFrom, filters.value.dateTo].filter(Boolean).length)
// 網址上已經有日期條件時，一進來就展開
const advancedOpen = ref(dateFilterCount.value > 0)
// 日期有錯時一定展開，錯誤訊息才看得到
const showAdvanced = computed(() => advancedOpen.value || !!dateRangeError.value)
const dateSummary = computed(() => `${filters.value.dateFrom ? formatDate(filters.value.dateFrom) : '不限'} ～ ${filters.value.dateTo ? formatDate(filters.value.dateTo) : '不限'}`)
function clearDates() {
  filters.value.dateFrom = ''
  filters.value.dateTo = ''
}

const editing = ref<Transaction | null>(null)
const editOpen = computed({ get: () => editing.value !== null, set: (v) => !v && (editing.value = null) })

async function remove(t: Transaction) {
  const ok = await confirm({ title: '刪除這筆交易？', message: `${formatDate(t.transactionDate)} ${TX_TYPE_LABEL[t.transactionType]} ${formatMoney(t.amount)}`, confirmText: '刪除', danger: true })
  if (!ok) return
  try {
    await api.del(`/transactions/${t.id}`)
    toast.success('已刪除')
    bump()
  } catch (e) {
    toast.error(errorText(e))
  }
}

function amountClass(t: Transaction) {
  return t.transactionType === 'income' ? 'text-emerald-700' : t.transactionType === 'expense' ? 'text-slate-900' : 'text-sky-700'
}
</script>

<template>
  <div>
    <PageHeader title="交易紀錄" description="收入、支出與轉帳。轉帳和繳卡費不算收入或支出。">
      <template #actions>
        <AppButton @click="quick.open('quick')">＋ 記一筆</AppButton>
      </template>
    </PageHeader>

    <!-- 篩選（D-A-010）：分類、帳戶、進階篩選在上方，類型是分頁標籤 -->
    <div class="card mb-4 p-4 pb-0">
      <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <AppField label="分類" for="f-cat">
          <!-- 轉帳沒有分類：提示寫在選單裡，不另外加一行字，三個欄位才會對齊 -->
          <select id="f-cat" v-model="filters.categoryId" class="field-input" :disabled="filters.transactionType === 'transfer'">
            <option value="">{{ filters.transactionType === 'transfer' ? '轉帳沒有分類' : '全部' }}</option>
            <option v-for="c in filterCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </AppField>
        <AppField label="帳戶" for="f-acc">
          <select id="f-acc" v-model="filters.accountId" class="field-input">
            <option value="">全部</option>
            <option v-for="a in accounts.data.value ?? []" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </AppField>
        <!-- 清除篩選放在這裡，不放在分頁標籤那排：出現時分頁不會跳動，手機上也不會被右下角的「＋」蓋住 -->
        <div class="flex items-center gap-2">
          <AppButton
            :variant="dateFilterCount > 0 ? 'soft' : 'secondary'"
            :aria-expanded="showAdvanced"
            aria-controls="advanced-filters"
            @click="advancedOpen = !showAdvanced"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 5h18l-7 8v6l-4-2v-4z" />
            </svg>
            進階篩選
            <span v-if="dateFilterCount > 0" class="num rounded-full bg-brand-700 px-1.5 text-xs leading-5 text-white" :aria-label="`已設定 ${dateFilterCount} 個日期條件`">{{ dateFilterCount }}</span>
          </AppButton>
          <AppButton v-if="hasFilter" variant="ghost" class="text-brand-700" @click="clearFilters">清除篩選</AppButton>
        </div>
      </div>

      <div v-if="showAdvanced" id="advanced-filters" class="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
        <AppField label="起日" for="f-from"><input id="f-from" v-model="filters.dateFrom" type="date" class="field-input"></AppField>
        <AppField label="迄日" for="f-to" :error="dateRangeError">
          <input id="f-to" v-model="filters.dateTo" type="date" class="field-input" :min="filters.dateFrom || undefined" :aria-invalid="!!dateRangeError || undefined">
        </AppField>
      </div>
      <!-- 收合時仍看得出有日期條件 -->
      <p v-else-if="dateFilterCount > 0" class="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span>日期：<span class="num">{{ dateSummary }}</span></span>
        <button type="button" class="font-semibold text-brand-700 hover:underline" @click="clearDates">清除日期</button>
      </p>

      <div class="mt-4 border-b border-slate-200">
        <div role="tablist" aria-label="交易類型" class="flex">
          <button
            v-for="(tab, i) in TYPE_TABS"
            :id="`tx-tab-${tab.value || 'all'}`"
            :key="tab.value"
            :ref="(el) => { tabEls[i] = el as HTMLButtonElement | null }"
            type="button"
            role="tab"
            :aria-selected="filters.transactionType === tab.value"
            :tabindex="filters.transactionType === tab.value ? 0 : -1"
            aria-controls="tx-list"
            class="-mb-px flex-1 border-b-2 px-2 pt-1 pb-2.5 text-sm font-semibold transition"
            :class="filters.transactionType === tab.value ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700'"
            @click="selectType(tab.value)"
            @keydown="onTabKeydown($event, i)"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <div id="tx-list" role="tabpanel" :aria-labelledby="`tx-tab-${filters.transactionType || 'all'}`" class="card overflow-hidden">
      <StateView
        :loading="result.loading.value"
        :error="result.error.value"
        :has-data="!!result.data.value"
        :empty="(result.data.value?.items.length ?? 0) === 0"
        :empty-title="hasFilter ? '沒有符合條件的交易' : '還沒有任何交易'"
        :empty-text="hasFilter ? '試試調整篩選條件' : '按右下角的「＋」記下第一筆'"
        @retry="result.reload"
      >
        <ul class="divide-y divide-slate-100">
          <li v-for="t in result.data.value!.items" :key="t.id" class="flex items-center gap-3 px-4 py-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-lg">
              {{ t.transactionType === 'transfer' ? '🔁' : CATEGORY_ICON[categoryCode(t.categoryId)] ?? '•' }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-medium text-slate-900">{{ t.transactionType === 'transfer' ? '轉帳' : categoryName(t.categoryId) }}</span>
                <AppBadge v-if="t.isBillGenerated" tone="violet">帳單</AppBadge>
                <AppBadge v-if="t.transactionDate > today" tone="amber">未來</AppBadge>
              </div>
              <p class="truncate text-xs text-slate-500">
                {{ formatDate(t.transactionDate) }} ·
                {{ t.transactionType === 'transfer' ? `${accountName(t.accountId)} → ${accountName(t.toAccountId)}` : accountName(t.accountId) }}
                <template v-if="t.note"> · {{ t.note }}</template>
              </p>
            </div>
            <p class="num shrink-0 text-right font-bold" :class="amountClass(t)">
              {{ t.transactionType === 'income' ? '+' : t.transactionType === 'expense' ? '−' : '' }}{{ formatMoney(t.amount) }}
            </p>
            <div class="flex shrink-0 gap-0.5">
              <!-- 帳單產生的交易：到帳單頁修改或取消繳費（§16.5） -->
              <NuxtLink v-if="t.isBillGenerated" to="/bills" class="px-2 py-1 text-xs text-slate-400 hover:text-brand-700">到帳單頁</NuxtLink>
              <!-- 帳戶已停用：不能修改或刪除，要先到帳戶頁重新啟用（§15.11、AC-26） -->
              <span
                v-else-if="touchesInactiveAccount(t)"
                class="px-2 py-1 text-xs text-slate-400"
                title="這筆交易的帳戶已停用，重新啟用帳戶後才能修改或刪除"
              >帳戶已停用</span>
              <template v-else>
                <AppButton size="sm" variant="ghost" :aria-label="`編輯 ${formatDate(t.transactionDate)} ${formatMoney(t.amount)}`" @click="editing = t">編輯</AppButton>
                <AppButton size="sm" variant="ghost" class="text-rose-600" :aria-label="`刪除 ${formatDate(t.transactionDate)} ${formatMoney(t.amount)}`" @click="remove(t)">刪除</AppButton>
              </template>
            </div>
          </li>
        </ul>
        <div class="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
          <span class="text-slate-500">共 {{ result.data.value!.total }} 筆</span>
          <div v-if="pages > 1" class="flex items-center gap-2">
            <AppButton size="sm" variant="secondary" :disabled="page <= 1" @click="page--">上一頁</AppButton>
            <span class="num">{{ page }} / {{ pages }}</span>
            <AppButton size="sm" variant="secondary" :disabled="page >= pages" @click="page++">下一頁</AppButton>
          </div>
        </div>
      </StateView>
    </div>

    <AppModal v-model:open="editOpen" title="編輯交易">
      <TransactionForm v-if="editing" :key="editing.id" :initial="editing" mode="full" :start-kind="editing.transactionType" @saved="editing = null" @cancel="editing = null" />
    </AppModal>
  </div>
</template>
