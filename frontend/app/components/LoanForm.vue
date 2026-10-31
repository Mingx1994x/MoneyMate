<script setup lang="ts">
/**
 * 貸款表單（B）。填完未償餘額、年利率、結清日後，自動呼叫 /loans/payment-preview
 * 填好「每月還款」（可以改），旁邊顯示預估總利息（PRD §15.8、FR-27）。
 * 驗收：1,000,000、3%、60 期 → 17,969、總利息 78,120。
 */
import { errorText } from '~/lib/api-error'
import { addMonthsClamped, isValidDate, todayTaipei } from '~/lib/date'
import { formatMoney, normalizeAmount, validateAmount } from '~/lib/money'
import type { Loan, LoanBody, LoanPaymentPreview, LoanStatus } from '~/types/api'
import { LOAN_TYPES } from '~/utils/labels'

const props = defineProps<{ initial?: Loan | null }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()

const api = useApi()
const toast = useToast()
const { bump } = useDataVersion()
const today = todayTaipei()

const blank = () => ({
  name: '', loanType: '房貸', outstandingBalance: '', interestRate: '', endDate: addMonthsClamped(today, 59),
  paymentDay: '5', monthlyPayment: '', status: 'active' as LoanStatus, note: '',
})
const draft = useDraft('loan-new', blank)
const form = props.initial
  ? ref({
      name: props.initial.name, loanType: props.initial.loanType,
      outstandingBalance: String(Number(props.initial.outstandingBalance)), interestRate: props.initial.interestRate ?? '',
      endDate: props.initial.endDate, paymentDay: String(props.initial.paymentDay),
      monthlyPayment: String(Number(props.initial.monthlyPayment)), status: props.initial.status, note: props.initial.note ?? '',
    })
  : draft.values

// ---------- 月付自動計算 ----------
const preview = ref<LoanPaymentPreview | null>(null)
const previewLoading = ref(false)
/** 使用者自己改過月付後，就不再自動覆蓋 */
const monthlyTouched = ref(!!props.initial)
const rateValid = computed(() => /^\d{1,3}(\.\d{1,3})?$/.test(form.value.interestRate.trim()) && Number(form.value.interestRate) <= 100)

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [form.value.outstandingBalance, form.value.interestRate, form.value.endDate],
  () => {
    clearTimeout(timer)
    const f = form.value
    if (!rateValid.value || validateAmount(f.outstandingBalance, { allowZero: true }) || !isValidDate(f.endDate)) {
      preview.value = null
      return
    }
    timer = setTimeout(async () => {
      previewLoading.value = true
      try {
        preview.value = await api.get<LoanPaymentPreview>('/loans/payment-preview', {
          outstandingBalance: normalizeAmount(f.outstandingBalance), interestRate: f.interestRate.trim(), endDate: f.endDate,
        })
        if (!monthlyTouched.value) form.value.monthlyPayment = String(Number(preview.value.monthlyPayment))
      } catch {
        preview.value = null
      } finally {
        previewLoading.value = false
      }
    }, 350)
  },
  { immediate: true },
)

function applySuggestion() {
  if (preview.value) {
    form.value.monthlyPayment = String(Number(preview.value.monthlyPayment))
    monthlyTouched.value = false
  }
}

// ---------- 送出 ----------
const errors = ref<Record<string, string | undefined>>({})
const submitError = ref<string | null>(null)
const saving = ref(false)

async function submit() {
  const f = form.value
  const day = Number(f.paymentDay)
  errors.value = {
    name: !f.name.trim() ? '請輸入貸款名稱' : f.name.trim().length > 30 ? '名稱最多 30 個字' : undefined,
    outstandingBalance: validateAmount(f.outstandingBalance, { allowZero: true, label: '未償餘額' }),
    interestRate: f.interestRate.trim() && !rateValid.value ? '年利率需為 0–100，最多 3 位小數' : undefined,
    endDate: !isValidDate(f.endDate) ? '請選擇結清日' : f.endDate < today && f.status === 'active' ? '結清日已過，狀態請選「已結清」' : undefined,
    paymentDay: Number.isInteger(day) && day >= 1 && day <= 31 ? undefined : '請填 1–31',
    monthlyPayment: f.monthlyPayment.trim()
      ? validateAmount(f.monthlyPayment, { label: '每月還款' })
      : rateValid.value ? undefined : '沒有年利率時，請自己填每月還款',
  }
  if (Object.values(errors.value).some(Boolean)) return
  const body: LoanBody = {
    name: f.name.trim(), loanType: f.loanType, outstandingBalance: normalizeAmount(f.outstandingBalance),
    monthlyPayment: f.monthlyPayment.trim() ? normalizeAmount(f.monthlyPayment) : null, paymentDay: day,
    endDate: f.endDate, interestRate: f.interestRate.trim() || null, status: f.status, note: f.note.trim() || null,
  }
  saving.value = true
  submitError.value = null
  try {
    if (props.initial) await api.patch(`/loans/${props.initial.id}`, body)
    else await api.post('/loans', body)
    if (!props.initial) draft.clear()
    toast.success(props.initial ? '貸款已更新' : '貸款已建立')
    bump()
    emit('saved')
  } catch (e) {
    submitError.value = errorText(e)
  } finally {
    saving.value = false
  }
}

const STATUSES = [
  { value: 'active' as LoanStatus, label: '還款中' },
  { value: 'closed' as LoanStatus, label: '已結清' },
]
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="submit">
    <FormError :message="submitError" />

    <div class="grid gap-4 sm:grid-cols-2">
      <AppField label="貸款名稱" for="loan-name" :error="errors.name" required>
        <input id="loan-name" v-model="form.name" class="field-input" maxlength="30" placeholder="例如：自住房貸" :aria-invalid="!!errors.name || undefined">
      </AppField>
      <AppField label="類型" for="loan-type" required>
        <select id="loan-type" v-model="form.loanType" class="field-input">
          <option v-for="t in LOAN_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
      </AppField>
    </div>

    <AppField label="未償餘額" for="loan-balance" :error="errors.outstandingBalance" required hint="還款後不會自動扣，請每月手動更新">
      <MoneyInput id="loan-balance" v-model="form.outstandingBalance" :invalid="!!errors.outstandingBalance" />
    </AppField>

    <div class="grid gap-4 sm:grid-cols-3">
      <AppField label="年利率（%）" for="loan-rate" :error="errors.interestRate" hint="選填；填了就自動算月付">
        <input id="loan-rate" v-model="form.interestRate" inputmode="decimal" class="field-input num" placeholder="例如 2.1" :aria-invalid="!!errors.interestRate || undefined">
      </AppField>
      <AppField label="結清日" for="loan-end" :error="errors.endDate" required :hint="preview ? `剩 ${preview.periods} 期` : undefined">
        <input id="loan-end" v-model="form.endDate" type="date" class="field-input" :aria-invalid="!!errors.endDate || undefined">
      </AppField>
      <AppField label="每月幾號繳" for="loan-day" :error="errors.paymentDay" required>
        <input id="loan-day" v-model="form.paymentDay" inputmode="numeric" class="field-input num" placeholder="1–31" :aria-invalid="!!errors.paymentDay || undefined">
      </AppField>
    </div>

    <AppField label="每月還款" for="loan-monthly" :error="errors.monthlyPayment" :required="!rateValid">
      <MoneyInput id="loan-monthly" v-model="form.monthlyPayment" :invalid="!!errors.monthlyPayment" @input="monthlyTouched = true" />
      <div class="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800" aria-live="polite">
        <template v-if="previewLoading">計算中…</template>
        <template v-else-if="preview">
          建議每月 <strong class="num">{{ formatMoney(preview.monthlyPayment) }}</strong>（本息平均攤還，共 {{ preview.periods }} 期），
          預估總利息 <strong class="num">{{ formatMoney(preview.totalInterest) }}</strong>
          <button
            v-if="monthlyTouched && Number(form.monthlyPayment) !== Number(preview.monthlyPayment)"
            type="button"
            class="ml-1 font-semibold underline"
            @click="applySuggestion"
          >套用建議值</button>
          <span class="block text-xs text-brand-700/80">只是估算；可以改成銀行實際的金額</span>
        </template>
        <template v-else>填好未償餘額、年利率、結清日，就會自動算出每月還款</template>
      </div>
    </AppField>

    <AppField label="狀態" required>
      <Segmented v-model="form.status" :options="STATUSES" label="狀態" />
    </AppField>

    <AppField label="備註" for="loan-note">
      <input id="loan-note" v-model="form.note" class="field-input" maxlength="200" placeholder="選填">
    </AppField>

    <div class="flex justify-end gap-2 pt-1">
      <AppButton variant="secondary" :disabled="saving" @click="emit('cancel')">取消</AppButton>
      <AppButton type="submit" :loading="saving">{{ initial ? '儲存修改' : '建立貸款' }}</AppButton>
    </div>
  </form>
</template>
