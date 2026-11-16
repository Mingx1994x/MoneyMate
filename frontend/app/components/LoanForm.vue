<script setup lang="ts">
/**
 * 貸款表單（B）。填完未償餘額、年利率、繳款日、結清日後，自動呼叫 /loans/payment-preview
 * 填好「每月還款」（可以改），旁邊顯示預估總利息與剩餘期數（PRD §15.8、FR-27、D-E-002）。
 * 驗收：1,000,000、3%、60 期 → 17,969、總利息 78,120。
 * - 新增：月付用試算結果預填，使用者改過就不再覆蓋
 * - 編輯：後端不自動重算月付（D-E-001），試算結果只當建議，使用者按「套用建議值」才會換
 */
import { errorText, fieldErrors } from '~/lib/api-error'
import { addMonthsClamped, isValidDate, todayTaipei } from '~/lib/date'
import { formatMoney, normalizeAmount, toCents, validateAmount } from '~/lib/money'
import type { CreateLoanBody, Loan, LoanPaymentPreview, LoanStatus, LoanType } from '~/types/api'
import { LOAN_TYPE_LABEL } from '~/utils/labels'

const props = defineProps<{ initial?: Loan | null }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()

const api = useApi()
const toast = useToast()
const { bump } = useDataVersion()
const today = todayTaipei()
/** 結清日最晚到台北今天加 50 年，再晚後端回 VALIDATION_FAILED */
const maxEndDate = addMonthsClamped(today, 50 * 12)

const LOAN_TYPE_OPTIONS = Object.entries(LOAN_TYPE_LABEL) as [LoanType, string][]

const blank = () => ({
  name: '', loanType: 'mortgage' as LoanType, outstandingBalance: '', interestRate: '', endDate: addMonthsClamped(today, 59),
  paymentDay: '5', monthlyPayment: '', status: 'active' as LoanStatus, note: '',
})
const draft = useDraft('loan-new', blank)
// 舊版草稿的類型存的是中文（「房貸」），改回預設值
if (!(draft.values.value.loanType in LOAN_TYPE_LABEL)) draft.values.value.loanType = 'mortgage'
const form = props.initial
  ? ref({
      name: props.initial.name, loanType: props.initial.loanType,
      // 已結清的貸款也顯示資料庫裡的真實餘額，不顯示 0（D-E-003）
      outstandingBalance: String(Number(props.initial.outstandingBalance)),
      interestRate: props.initial.interestRate === null ? '' : String(props.initial.interestRate),
      endDate: props.initial.endDate, paymentDay: String(props.initial.paymentDay),
      monthlyPayment: String(Number(props.initial.monthlyPayment)), status: props.initial.status, note: props.initial.note ?? '',
    })
  : draft.values

// ---------- 月付自動計算 ----------
const preview = ref<LoanPaymentPreview | null>(null)
const previewLoading = ref(false)
/** 使用者自己改過月付後，就不再自動覆蓋；編輯時一開始就算改過（D-E-001） */
const monthlyTouched = ref(!!props.initial)
const rateValid = computed(() => /^\d{1,3}(\.\d{1,3})?$/.test(form.value.interestRate.trim()) && Number(form.value.interestRate) <= 100)
const paymentDayValid = computed(() => /^\d{1,2}$/.test(form.value.paymentDay.trim()) && Number(form.value.paymentDay) >= 1 && Number(form.value.paymentDay) <= 31)

/** 後端的呼叫條件：餘額 > 0、利率有填、繳款日有填、結清日合法而且不早於台北今天 */
const canPreview = computed(() => {
  const f = form.value
  return !validateAmount(f.outstandingBalance) && toCents(normalizeAmount(f.outstandingBalance)) > 0 && rateValid.value
    && paymentDayValid.value && isValidDate(f.endDate) && f.endDate >= today && f.endDate <= maxEndDate
})

let timer: ReturnType<typeof setTimeout> | undefined
/** 每次試算加 1；回來的結果不是最新一次的就丟掉（使用者連續修改時，舊的回應可能比較晚到） */
let previewSeq = 0
watch(
  () => [form.value.outstandingBalance, form.value.interestRate, form.value.endDate, form.value.paymentDay],
  () => {
    clearTimeout(timer)
    const seq = ++previewSeq
    if (!canPreview.value) {
      preview.value = null
      previewLoading.value = false
      return
    }
    timer = setTimeout(async () => {
      const f = form.value
      previewLoading.value = true
      try {
        const res = await api.get<LoanPaymentPreview>('/loans/payment-preview', {
          outstandingBalance: normalizeAmount(f.outstandingBalance), interestRate: f.interestRate.trim(),
          paymentDay: Number(f.paymentDay), endDate: f.endDate,
        })
        if (seq !== previewSeq) return
        preview.value = res
        if (!monthlyTouched.value) form.value.monthlyPayment = String(Number(res.monthlyPayment))
      } catch {
        if (seq === previewSeq) preview.value = null
      } finally {
        if (seq === previewSeq) previewLoading.value = false
      }
    }, 300)
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

/** 表單上有顯示錯誤的欄位（和後端 details.field 同名） */
const FORM_FIELDS = ['name', 'outstandingBalance', 'interestRate', 'endDate', 'paymentDay', 'monthlyPayment', 'note']

/**
 * 結清日已過但狀態不是已結清。新增時一律檢查；編輯時只在結清日或狀態跟原值不同時檢查（D-E-004），
 * 不然過了結清日還沒改成已結清的貸款，連備註、餘額都改不了。
 */
function endDateInPast(f: typeof form.value) {
  if (f.status === 'closed' || f.endDate >= today) return false
  const init = props.initial
  return !init || f.endDate !== init.endDate || f.status !== init.status
}

async function submit() {
  const f = form.value
  errors.value = {
    name: !f.name.trim() ? '請輸入貸款名稱' : f.name.trim().length > 30 ? '名稱最多 30 個字' : undefined,
    outstandingBalance: validateAmount(f.outstandingBalance, { allowZero: true, label: '未償餘額' }),
    interestRate: f.interestRate.trim() && !rateValid.value ? '年利率需為 0–100，最多 3 位小數' : undefined,
    endDate: !isValidDate(f.endDate)
      ? '請選擇結清日'
      : f.endDate > maxEndDate ? '結清日最晚到 50 年後'
      : endDateInPast(f) ? '結清日已過，狀態請選「已結清」' : undefined,
    paymentDay: paymentDayValid.value ? undefined : '請填 1–31',
    // 月付一律要送：PATCH 送 null 會 400；新增時也用試算結果預填，不靠後端自動算
    monthlyPayment: f.monthlyPayment.trim()
      ? validateAmount(f.monthlyPayment, { label: '每月還款' })
      : rateValid.value ? '請填每月還款' : '沒有年利率時，請自己填每月還款',
    note: Array.from(f.note.trim()).length > 200 ? '備註最多 200 字' : undefined,
  }
  if (Object.values(errors.value).some(Boolean)) return
  const body: CreateLoanBody = {
    name: f.name.trim(), loanType: f.loanType, outstandingBalance: normalizeAmount(f.outstandingBalance),
    monthlyPayment: normalizeAmount(f.monthlyPayment), paymentDay: Number(f.paymentDay), endDate: f.endDate,
    interestRate: f.interestRate.trim() ? Number(f.interestRate) : null, status: f.status, note: f.note.trim() || null,
  }
  saving.value = true
  submitError.value = null
  try {
    // 修改也送整份：後端比對的是值，沒改的欄位不會被當成有改（D-E-004）
    if (props.initial) await api.patch(`/loans/${props.initial.id}`, body)
    else await api.post('/loans', body)
    if (!props.initial) draft.clear()
    toast.success(props.initial ? '貸款已更新' : '貸款已建立')
    bump()
    emit('saved')
  } catch (e) {
    // 後端的欄位錯誤（例如 LOAN_END_DATE_IN_PAST 在 endDate）顯示在對應欄位下面，其他的顯示在表單上方
    const fields = fieldErrors(e)
    const shown = Object.keys(fields).filter((k) => FORM_FIELDS.includes(k))
    if (shown.length) errors.value = fields
    else submitError.value = errorText(e)
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
          <option v-for="[value, label] in LOAN_TYPE_OPTIONS" :key="value" :value="value">{{ label }}</option>
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
      <AppField label="結清日" for="loan-end" :error="errors.endDate" required :hint="preview ? `剩 ${preview.installments} 期` : undefined">
        <input id="loan-end" v-model="form.endDate" type="date" class="field-input" :aria-invalid="!!errors.endDate || undefined">
      </AppField>
      <AppField label="每月幾號繳" for="loan-day" :error="errors.paymentDay" required>
        <input id="loan-day" v-model="form.paymentDay" inputmode="numeric" class="field-input num" placeholder="1–31" :aria-invalid="!!errors.paymentDay || undefined">
      </AppField>
    </div>

    <AppField label="每月還款" for="loan-monthly" :error="errors.monthlyPayment" required>
      <MoneyInput id="loan-monthly" v-model="form.monthlyPayment" :invalid="!!errors.monthlyPayment" @input="monthlyTouched = true" />
      <div class="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800" aria-live="polite">
        <template v-if="previewLoading">計算中…</template>
        <template v-else-if="preview">
          建議每月 <strong class="num">{{ formatMoney(preview.monthlyPayment) }}</strong>（本息平均攤還，共 {{ preview.installments }} 期），
          預估總利息 <strong class="num">{{ formatMoney(preview.totalInterest) }}</strong>
          <button
            v-if="monthlyTouched && Number(form.monthlyPayment) !== Number(preview.monthlyPayment)"
            type="button"
            class="ml-1 font-semibold underline"
            @click="applySuggestion"
          >套用建議值</button>
          <span class="block text-xs text-brand-700/80">只是估算；可以改成銀行實際的金額</span>
        </template>
        <template v-else-if="isValidDate(form.endDate) && form.endDate < today">結清日已過，不計算建議月付</template>
        <template v-else-if="!form.interestRate.trim()">沒有年利率時，請自己填每月還款；填了年利率就會自動算</template>
        <template v-else>填好未償餘額、年利率、繳款日、結清日，就會自動算出每月還款</template>
      </div>
    </AppField>

    <AppField label="狀態" required>
      <Segmented v-model="form.status" :options="STATUSES" label="狀態" />
    </AppField>

    <AppField label="備註" for="loan-note" :error="errors.note">
      <input id="loan-note" v-model="form.note" class="field-input" placeholder="選填">
    </AppField>

    <div class="flex justify-end gap-2 pt-1">
      <AppButton variant="secondary" :disabled="saving" @click="emit('cancel')">取消</AppButton>
      <AppButton type="submit" :loading="saving">{{ initial ? '儲存修改' : '建立貸款' }}</AppButton>
    </div>
  </form>
</template>
