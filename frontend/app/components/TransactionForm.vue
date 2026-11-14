<script setup lang="ts">
/**
 * 交易表單（B 主責）。同一個元件用在：
 * - 快速記帳（mode="quick"）：只要金額＋點分類，日期／帳戶／備註收在「更多」（PRD FR-09、§17）
 * - 轉帳、繳卡費（kind="transfer"／"card"）：繳卡費＝銀行 → 信用卡的轉帳，不算支出（§15.10）
 * - 交易頁的編輯（initial 有值）
 */
import { errorText } from '~/lib/api-error'
import { formatDateShort, isValidDate, todayTaipei } from '~/lib/date'
import { formatMoney, normalizeAmount, toCents, validateAmount } from '~/lib/money'
import type { Transaction, TransactionBody, TransactionType } from '~/types/api'
import { CATEGORY_ICON } from '~/utils/labels'

type Kind = 'expense' | 'income' | 'transfer' | 'card'

const props = withDefaults(
  defineProps<{
    mode?: 'quick' | 'full'
    initial?: Transaction | null
    startKind?: Kind
    cardId?: string
  }>(),
  { mode: 'full', initial: null, startKind: 'expense' },
)
const emit = defineEmits<{ saved: [Transaction]; cancel: [] }>()

const api = useApi()
const toast = useToast()
const { bump } = useDataVersion()
const mem = useMemory()
const { accounts, categories, usableAccounts, categoriesOf } = useLookups()

const isEdit = computed(() => !!props.initial)
const today = todayTaipei()

// ---------- 表單值（新增時會存草稿） ----------
function blank() {
  return {
    kind: props.startKind as Kind,
    amount: '',
    categoryId: '',
    accountId: '',
    toAccountId: '',
    transactionDate: today,
    note: '',
  }
}
const draft = useDraft(`tx-${props.mode}`, blank)
const form = isEdit.value ? ref(blank()) : draft.values
if (props.initial) {
  const t = props.initial
  form.value = {
    kind: t.transactionType, amount: String(Number(t.amount)), categoryId: t.categoryId ?? '',
    accountId: t.accountId, toAccountId: t.toAccountId ?? '', transactionDate: t.transactionDate, note: t.note ?? '',
  }
} else if (props.startKind !== 'expense' || props.cardId) {
  form.value.kind = props.startKind
  if (props.cardId) form.value.toAccountId = props.cardId
}

const showMore = ref(props.mode === 'full')
const errors = ref<Record<string, string | undefined>>({})
const submitError = ref<string | null>(null)
const saving = ref(false)

const txType = computed<TransactionType>(() => (form.value.kind === 'card' ? 'transfer' : form.value.kind))
const isTransfer = computed(() => txType.value === 'transfer')

// ---------- 選項 ----------
const fromOptions = computed(() => {
  // 繳卡費：只能從現金／銀行付
  const list = form.value.kind === 'card'
    ? usableAccounts.value.filter((a) => a.accountType === 'cash' || a.accountType === 'bank')
    : usableAccounts.value
  // 編輯舊交易時，保留原本的帳戶（就算已停用也顯示，後端會擋）
  const orig = props.initial ? (accounts.data.value ?? []).find((a) => a.id === props.initial!.accountId) : undefined
  return orig && !list.includes(orig) ? [orig, ...list] : list
})
const toOptions = computed(() => {
  const list = form.value.kind === 'card'
    ? usableAccounts.value.filter((a) => a.accountType === 'credit_card')
    : usableAccounts.value
  return list.filter((a) => a.id !== form.value.accountId)
})
const sortedCategories = computed(() => {
  if (isTransfer.value) return []
  const usage = mem.categoryUsage()
  return [...categoriesOf(txType.value as 'income' | 'expense')].sort(
    (a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.sortOrder - b.sortOrder,
  )
})
const selectedCard = computed(() => (accounts.data.value ?? []).find((a) => a.id === form.value.toAccountId))
const cardDebt = computed(() => (selectedCard.value ? Math.max(0, -toCents(selectedCard.value.currentBalance)) : 0))

// ---------- 預設值：帳戶＝上次使用、分類＝上次使用 ----------
function applyDefaults() {
  if (isEdit.value) return
  const f = form.value
  const from = fromOptions.value
  if (!from.some((a) => a.id === f.accountId)) {
    const last = mem.lastAccountId()
    f.accountId = from.find((a) => a.id === last)?.id ?? from.find((a) => a.accountType === 'bank')?.id ?? from[0]?.id ?? ''
  }
  if (isTransfer.value) {
    if (!toOptions.value.some((a) => a.id === f.toAccountId)) f.toAccountId = toOptions.value[0]?.id ?? ''
    f.categoryId = ''
  } else {
    f.toAccountId = ''
    if (!sortedCategories.value.some((c) => c.id === f.categoryId)) f.categoryId = ''
  }
  if (f.kind === 'card' && !f.amount && cardDebt.value > 0) f.amount = String(cardDebt.value / 100)
}
watch([() => accounts.data.value, () => categories.data.value, () => form.value.kind], applyDefaults)
watch(() => form.value.toAccountId, () => {
  if (form.value.kind === 'card' && cardDebt.value > 0 && !isEdit.value) form.value.amount = String(cardDebt.value / 100)
})

function setKind(k: Kind) {
  form.value.kind = k
  errors.value = {}
}

function pickCategory(id: string) {
  form.value.categoryId = id
  errors.value.categoryId = undefined
  // 快速記帳：金額已填好時，點分類就直接存（2 次操作完成一筆）
  if (props.mode === 'quick' && !validateAmount(form.value.amount)) void submit()
}

// ---------- 送出 ----------
function validate() {
  const f = form.value
  const e: Record<string, string | undefined> = {}
  e.amount = validateAmount(f.amount)
  if (!isTransfer.value && !f.categoryId) e.categoryId = '請點一個分類'
  if (!f.accountId) e.accountId = '請選擇帳戶'
  if (isTransfer.value && !f.toAccountId) e.toAccountId = '請選擇轉入帳戶'
  if (isTransfer.value && f.toAccountId && f.toAccountId === f.accountId) e.toAccountId = '轉出和轉入不能是同一個帳戶'
  if (!isValidDate(f.transactionDate)) e.transactionDate = '請選擇有效的日期'
  if (f.note.length > 200) e.note = '備註最多 200 字'
  errors.value = e
  // 錯誤在「更多」裡面時自動展開
  if (e.accountId || e.toAccountId || e.transactionDate || e.note) showMore.value = true
  return !Object.values(e).some(Boolean)
}

async function submit() {
  if (saving.value || !validate()) return
  const f = form.value
  const body: TransactionBody = {
    transactionType: txType.value,
    amount: normalizeAmount(f.amount),
    accountId: f.accountId,
    toAccountId: isTransfer.value ? f.toAccountId : null,
    categoryId: isTransfer.value ? null : f.categoryId,
    transactionDate: f.transactionDate,
    note: f.note.trim() || null,
  }
  saving.value = true
  submitError.value = null
  try {
    const saved = props.initial
      ? await api.patch<Transaction>(`/transactions/${props.initial.id}`, body)
      : await api.post<Transaction>('/transactions', body)
    mem.setLastAccountId(f.accountId)
    if (body.categoryId) {
      mem.setLastCategoryId(body.transactionType, body.categoryId)
      mem.bumpCategory(body.categoryId)
    }
    if (!isEdit.value) draft.clear()
    const label = f.kind === 'card' ? '繳卡費' : f.kind === 'transfer' ? '轉帳' : f.kind === 'income' ? '收入' : '支出'
    toast.success(`已${isEdit.value ? '更新' : '記下'}${label} ${formatMoney(body.amount)}`)
    bump()
    emit('saved', saved)
  } catch (e) {
    submitError.value = errorText(e)
  } finally {
    saving.value = false
  }
}

const KIND_OPTIONS = [
  { value: 'expense' as Kind, label: '支出' },
  { value: 'income' as Kind, label: '收入' },
  { value: 'transfer' as Kind, label: '轉帳' },
  { value: 'card' as Kind, label: '繳卡費' },
]
const accountLabel = (a: { name: string; currentBalance: string; isActive: boolean }) =>
  `${a.name}（${formatMoney(a.currentBalance)}）${a.isActive ? '' : '［已停用］'}`
const summaryText = computed(() => {
  const acc = fromOptions.value.find((a) => a.id === form.value.accountId)
  const date = form.value.transactionDate === today ? '今天' : isValidDate(form.value.transactionDate) ? formatDateShort(form.value.transactionDate) : '?'
  return `${acc?.name ?? '未選帳戶'} · ${date}${form.value.note ? ' · 有備註' : ''}`
})
</script>

<template>
  <div v-if="!accounts.data.value || !categories.data.value" class="space-y-3 py-2" aria-busy="true">
    <div class="h-10 animate-pulse rounded-xl bg-slate-100" />
    <div class="h-16 animate-pulse rounded-xl bg-slate-100" />
    <div class="h-24 animate-pulse rounded-xl bg-slate-100" />
  </div>
  <!-- 還沒有可用帳戶：先引導建立（AC-21） -->
  <div v-else-if="usableAccounts.length === 0" class="py-6 text-center">
    <p class="text-3xl">🏦</p>
    <p class="mt-2 font-semibold text-slate-800">先建立一個帳戶，才能開始記帳</p>
    <p class="mt-1 text-sm text-slate-500">例如「現金錢包」或你的薪轉帳戶</p>
    <NuxtLink to="/accounts?new=1" @click="emit('cancel')">
      <AppButton class="mt-4">建立帳戶</AppButton>
    </NuxtLink>
  </div>

  <form v-else class="space-y-4" novalidate @submit.prevent="submit">
    <FormError :message="submitError" />
    <p v-if="draft.hasDraft.value && !isEdit" class="text-xs text-slate-500">
      已帶入上次沒存的內容 · <button type="button" class="underline" @click="draft.clear()">清除</button>
    </p>

    <Segmented :model-value="form.kind" :options="isEdit ? KIND_OPTIONS.slice(0, 3) : KIND_OPTIONS" label="交易類型" @update:model-value="setKind" />

    <AppField label="金額" for="tx-amount" :error="errors.amount" required>
      <MoneyInput id="tx-amount" v-model="form.amount" :size="mode === 'quick' ? 'xl' : 'md'" :invalid="!!errors.amount" autofocus />
      <p v-if="form.kind === 'card' && selectedCard" class="mt-1 text-xs text-slate-500">
        {{ selectedCard.name }} 目前欠款 {{ formatMoney(cardDebt / 100) }}；可以只繳一部分
      </p>
    </AppField>

    <!-- 分類按鈕（常用的排前面） -->
    <AppField v-if="!isTransfer" label="分類" :error="errors.categoryId" required>
      <div class="grid grid-cols-4 gap-2 sm:grid-cols-5">
        <button
          v-for="c in sortedCategories"
          :key="c.id"
          type="button"
          class="chip flex-col gap-0.5 px-1 py-2"
          :class="form.categoryId === c.id ? 'chip-on' : 'chip-off'"
          :aria-pressed="form.categoryId === c.id"
          @click="pickCategory(c.id)"
        >
          <span class="text-lg leading-none">{{ CATEGORY_ICON[c.code] ?? '•' }}</span>
          <span class="text-xs">{{ c.name }}</span>
        </button>
      </div>
      <p v-if="mode === 'quick'" class="mt-1 text-xs text-slate-400">填好金額後點分類就會直接存</p>
    </AppField>

    <!-- 轉帳／繳卡費 -->
    <div v-if="isTransfer" class="grid gap-4 sm:grid-cols-2">
      <AppField :label="form.kind === 'card' ? '從哪個帳戶付' : '轉出帳戶'" for="tx-from" :error="errors.accountId" required>
        <select id="tx-from" v-model="form.accountId" class="field-input" :aria-invalid="!!errors.accountId || undefined">
          <option v-for="a in fromOptions" :key="a.id" :value="a.id">{{ accountLabel(a) }}</option>
        </select>
      </AppField>
      <AppField :label="form.kind === 'card' ? '繳哪張信用卡' : '轉入帳戶'" for="tx-to" :error="errors.toAccountId" required>
        <select id="tx-to" v-model="form.toAccountId" class="field-input" :aria-invalid="!!errors.toAccountId || undefined">
          <option value="" disabled>請選擇</option>
          <option v-for="a in toOptions" :key="a.id" :value="a.id">{{ accountLabel(a) }}</option>
        </select>
        <p v-if="form.kind === 'card' && toOptions.length === 0" class="mt-1 text-xs text-amber-700">還沒有信用卡帳戶</p>
      </AppField>
    </div>

    <!-- 更多：日期、帳戶、備註 -->
    <button
      v-if="mode === 'quick' && !showMore"
      type="button"
      class="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-100"
      @click="showMore = true"
    >
      <span>{{ summaryText }}</span>
      <span class="font-semibold text-brand-700">更多 ▾</span>
    </button>
    <div v-if="showMore" class="grid gap-4 sm:grid-cols-2">
      <AppField label="日期" for="tx-date" :error="errors.transactionDate" required :hint="form.transactionDate > today ? '未來日期：不會算進目前餘額，到了那天才算' : undefined">
        <input id="tx-date" v-model="form.transactionDate" type="date" class="field-input" :aria-invalid="!!errors.transactionDate || undefined">
      </AppField>
      <AppField v-if="!isTransfer" label="帳戶" for="tx-account" :error="errors.accountId" required>
        <select id="tx-account" v-model="form.accountId" class="field-input" :aria-invalid="!!errors.accountId || undefined">
          <option v-for="a in fromOptions" :key="a.id" :value="a.id">{{ accountLabel(a) }}</option>
        </select>
      </AppField>
      <AppField label="備註" for="tx-note" :error="errors.note" class="sm:col-span-2">
        <input id="tx-note" v-model="form.note" type="text" maxlength="200" class="field-input" placeholder="選填，例如：午餐">
      </AppField>
    </div>

    <div class="flex gap-2 pt-1">
      <AppButton variant="secondary" :disabled="saving" @click="emit('cancel')">取消</AppButton>
      <AppButton type="submit" :loading="saving" block size="lg">
        {{ isEdit ? '儲存修改' : form.kind === 'card' ? '繳卡費' : '記下來' }}
      </AppButton>
    </div>
  </form>
</template>
