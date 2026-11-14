<script setup lang="ts">
/**
 * 交易列表頁 —— PRD §20.1：由 C 負責（篩選邏輯和 C 的 API 綁最緊），B 審查。
 * 這裡是 B 先做的暫時版本，示範如何使用共用元件與 TransactionForm。
 * 篩選：日期、類型、分類、帳戶；分頁 20 筆；帳單產生的交易隱藏修改／刪除。
 */
import { errorText } from '~/lib/api-error'
import { formatDate, todayTaipei } from '~/lib/date'
import { formatMoney } from '~/lib/money'
import type { Paginated, Transaction, TransactionType } from '~/types/api'
import { CATEGORY_ICON, TX_TYPE_LABEL } from '~/utils/labels'

const api = useApi()
const toast = useToast()
const { confirm } = useConfirm()
const { bump } = useDataVersion()
const quick = useQuickAdd()
const { accounts, categories, accountName, categoryName } = useLookups()

// 參數名稱與 C 的後端一致：dateFrom、dateTo、transactionType
const filters = ref({ dateFrom: '', dateTo: '', transactionType: '' as '' | TransactionType, categoryId: '', accountId: '' })
const page = ref(1)
const PAGE_SIZE = 20
const today = todayTaipei()

const result = useResource(
  () => api.get<Paginated<Transaction>>('/transactions', { ...filters.value, page: page.value, pageSize: PAGE_SIZE }),
  { watch: [page, filters] },
)
watch(filters, () => (page.value = 1), { deep: true })
const pages = computed(() => Math.max(1, Math.ceil((result.data.value?.total ?? 0) / PAGE_SIZE)))
const filterCategories = computed(() => (categories.data.value ?? []).filter((c) => !filters.value.transactionType || c.type === filters.value.transactionType))
const hasFilter = computed(() => Object.values(filters.value).some(Boolean))
const categoryCode = (id: string | null) => (categories.data.value ?? []).find((c) => c.id === id)?.code ?? ''

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
        <AppButton variant="secondary" @click="quick.open('transfer')">轉帳</AppButton>
        <AppButton @click="quick.open('quick')">＋ 記一筆</AppButton>
      </template>
    </PageHeader>
    <OwnerNote owner="C" text="交易列表頁由 C 負責、B 審查；這是 B 先做的暫時版本。記帳表單（TransactionForm）是 B 的共用元件。" />

    <!-- 篩選 -->
    <div class="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <AppField label="起日" for="f-from"><input id="f-from" v-model="filters.dateFrom" type="date" class="field-input"></AppField>
      <AppField label="迄日" for="f-to"><input id="f-to" v-model="filters.dateTo" type="date" class="field-input"></AppField>
      <AppField label="類型" for="f-type">
        <select id="f-type" v-model="filters.transactionType" class="field-input" @change="filters.categoryId = ''">
          <option value="">全部</option>
          <option value="income">收入</option>
          <option value="expense">支出</option>
          <option value="transfer">轉帳</option>
        </select>
      </AppField>
      <AppField label="分類" for="f-cat">
        <select id="f-cat" v-model="filters.categoryId" class="field-input" :disabled="filters.transactionType === 'transfer'">
          <option value="">全部</option>
          <option v-for="c in filterCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </AppField>
      <AppField label="帳戶" for="f-acc">
        <select id="f-acc" v-model="filters.accountId" class="field-input">
          <option value="">全部</option>
          <option v-for="a in accounts.data.value ?? []" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </AppField>
      <div v-if="hasFilter" class="sm:col-span-2 lg:col-span-5">
        <button class="text-sm font-semibold text-brand-700 hover:underline" @click="filters = { dateFrom: '', dateTo: '', transactionType: '', categoryId: '', accountId: '' }">清除篩選</button>
      </div>
    </div>

    <div class="card overflow-hidden">
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
              <!-- 帳單產生的交易：隱藏修改／刪除（§17） -->
              <template v-if="!t.isBillGenerated">
                <AppButton size="sm" variant="ghost" @click="editing = t">編輯</AppButton>
                <AppButton size="sm" variant="ghost" class="text-rose-600" @click="remove(t)">刪除</AppButton>
              </template>
              <NuxtLink v-else to="/bills" class="px-2 py-1 text-xs text-slate-400 hover:text-brand-700">到帳單頁</NuxtLink>
            </div>
          </li>
        </ul>
        <div v-if="pages > 1" class="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
          <span class="text-slate-500">共 {{ result.data.value!.total }} 筆</span>
          <div class="flex items-center gap-2">
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
