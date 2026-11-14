<script setup lang="ts">
/** 帳單表單（B）。只能用支出分類、扣款帳戶必須啟用；已繳帳單只能改名稱與備註（PRD §16.6） */
import { errorText } from '~/lib/api-error'
import { addDays, isValidDate, todayTaipei } from '~/lib/date'
import { normalizeAmount, validateAmount } from '~/lib/money'
import type { Bill, BillBody, Recurrence } from '~/types/api'
import { CATEGORY_ICON } from '~/utils/labels'

const props = defineProps<{ initial?: Bill | null }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()

const api = useApi()
const toast = useToast()
const { bump } = useDataVersion()
const { usableAccounts, categoriesOf, accounts } = useLookups()

const paid = computed(() => props.initial?.status === 'paid')
const blank = () => ({
  name: '', amount: '', categoryId: '', accountId: '', dueDate: addDays(todayTaipei(), 7), recurrence: 'monthly' as Recurrence, note: '',
})
const draft = useDraft('bill-new', blank)
const form = props.initial
  ? ref({
      name: props.initial.name, amount: String(Number(props.initial.amount)), categoryId: props.initial.categoryId,
      accountId: props.initial.accountId, dueDate: props.initial.dueDate, recurrence: props.initial.recurrence, note: props.initial.note ?? '',
    })
  : draft.values

watch(() => accounts.data.value, () => {
  if (!form.value.accountId) form.value.accountId = usableAccounts.value.find((a) => a.accountType === 'bank')?.id ?? usableAccounts.value[0]?.id ?? ''
})

const errors = ref<Record<string, string | undefined>>({})
const submitError = ref<string | null>(null)
const saving = ref(false)

async function submit() {
  const f = form.value
  errors.value = paid.value
    ? { name: f.name.trim() ? undefined : '請輸入帳單名稱' }
    : {
        name: !f.name.trim() ? '請輸入帳單名稱' : f.name.trim().length > 30 ? '名稱最多 30 個字' : undefined,
        amount: validateAmount(f.amount),
        categoryId: f.categoryId ? undefined : '請選擇分類',
        accountId: f.accountId ? undefined : '請選擇扣款帳戶',
        dueDate: isValidDate(f.dueDate) ? undefined : '請選擇到期日',
      }
  if (Object.values(errors.value).some(Boolean)) return
  saving.value = true
  submitError.value = null
  try {
    if (paid.value) {
      await api.patch(`/bills/${props.initial!.id}`, { name: f.name.trim(), note: f.note.trim() || null })
    } else {
      const body: BillBody = {
        name: f.name.trim(), amount: normalizeAmount(f.amount), categoryId: f.categoryId, accountId: f.accountId,
        dueDate: f.dueDate, recurrence: f.recurrence, note: f.note.trim() || null,
      }
      if (props.initial) await api.patch(`/bills/${props.initial.id}`, body)
      else await api.post('/bills', body)
    }
    if (!props.initial) draft.clear()
    toast.success(props.initial ? '帳單已更新' : '帳單已建立')
    bump()
    emit('saved')
  } catch (e) {
    submitError.value = errorText(e)
  } finally {
    saving.value = false
  }
}

const RECURRENCES = [
  { value: 'none' as Recurrence, label: '只有一次' },
  { value: 'monthly' as Recurrence, label: '每月' },
  { value: 'yearly' as Recurrence, label: '每年' },
]
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="submit">
    <FormError :message="submitError" />
    <p v-if="paid" class="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">這張帳單已繳，只能改名稱與備註。要改金額或日期，請先取消繳費。</p>

    <AppField label="帳單名稱" for="bill-name" :error="errors.name" required>
      <input id="bill-name" v-model="form.name" class="field-input" maxlength="30" placeholder="例如：電費、房租" :aria-invalid="!!errors.name || undefined">
    </AppField>

    <template v-if="!paid">
      <div class="grid gap-4 sm:grid-cols-2">
        <AppField label="每期金額（預定）" for="bill-amount" :error="errors.amount" required hint="實際繳費時可以改">
          <MoneyInput id="bill-amount" v-model="form.amount" :invalid="!!errors.amount" />
        </AppField>
        <AppField label="到期日" for="bill-due" :error="errors.dueDate" required :hint="form.dueDate.endsWith('-31') || form.dueDate.endsWith('-30') || form.dueDate.endsWith('-29') ? '遇到比較短的月份，會改成當月最後一天' : undefined">
          <input id="bill-due" v-model="form.dueDate" type="date" class="field-input" :aria-invalid="!!errors.dueDate || undefined">
        </AppField>
      </div>

      <AppField label="多久繳一次" required>
        <Segmented v-model="form.recurrence" :options="RECURRENCES" label="重複" />
        <p class="mt-1 text-xs text-slate-500">重複的帳單，繳費後會自動產生下一期</p>
      </AppField>

      <AppField label="分類" :error="errors.categoryId" required>
        <div class="grid grid-cols-4 gap-2 sm:grid-cols-5">
          <button
            v-for="c in categoriesOf('expense')"
            :key="c.id"
            type="button"
            class="chip flex-col gap-0.5 px-1 py-2"
            :class="form.categoryId === c.id ? 'chip-on' : 'chip-off'"
            @click="form.categoryId = c.id"
          >
            <span class="text-lg leading-none">{{ CATEGORY_ICON[c.code] ?? '•' }}</span>
            <span class="text-xs">{{ c.name }}</span>
          </button>
        </div>
      </AppField>

      <AppField label="扣款帳戶" for="bill-account" :error="errors.accountId" required>
        <select id="bill-account" v-model="form.accountId" class="field-input" :aria-invalid="!!errors.accountId || undefined">
          <option value="" disabled>請選擇</option>
          <option v-for="a in usableAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </AppField>
    </template>

    <AppField label="備註" for="bill-note">
      <input id="bill-note" v-model="form.note" class="field-input" maxlength="200" placeholder="選填">
    </AppField>

    <div class="flex justify-end gap-2 pt-1">
      <AppButton variant="secondary" :disabled="saving" @click="emit('cancel')">取消</AppButton>
      <AppButton type="submit" :loading="saving">{{ initial ? '儲存修改' : '建立帳單' }}</AppButton>
    </div>
  </form>
</template>
