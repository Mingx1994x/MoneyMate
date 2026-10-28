<script setup lang="ts">
/** 帳戶表單（B）。四種類型；只有信用卡的初始餘額可以是負數（PRD FR-05） */
import { errorText } from '~/lib/api-error'
import { normalizeAmount, validateAmount } from '~/lib/money'
import type { Account, AccountType, CreateAccountBody } from '~/types/api'
import { ACCOUNT_TYPE_ICON, ACCOUNT_TYPE_LABEL } from '~/utils/labels'

type AccountFormValues = Omit<CreateAccountBody, 'deductFromEstimate'>

const props = defineProps<{ initial?: Account | null; save: (v: AccountFormValues) => Promise<void> }>()
const emit = defineEmits<{ cancel: [] }>()

const blank = () => ({ name: '', accountType: 'bank' as AccountType, openingBalance: '', note: '' })
const draft = useDraft('account-new', blank)
const form = props.initial
  ? ref({
      name: props.initial.name,
      accountType: props.initial.accountType,
      openingBalance: String(Number(props.initial.openingBalance)),
      note: props.initial.note ?? '',
    })
  : draft.values

const errors = ref<Record<string, string | undefined>>({})
const submitError = ref<string | null>(null)
const saving = ref(false)
const isCard = computed(() => form.value.accountType === 'credit_card')
const TYPES: AccountType[] = ['cash', 'bank', 'investment', 'credit_card']

async function submit() {
  const f = form.value
  errors.value = {
    name: !f.name.trim() ? '請輸入帳戶名稱' : f.name.trim().length > 30 ? '名稱最多 30 個字' : undefined,
    openingBalance: f.openingBalance.trim() === ''
      ? undefined // 空白當作 0
      : validateAmount(f.openingBalance, { allowZero: true, allowNegative: isCard.value, label: '初始餘額' }),
    note: f.note.length > 200 ? '備註最多 200 字' : undefined,
  }
  if (Object.values(errors.value).some(Boolean)) return
  saving.value = true
  submitError.value = null
  try {
    await props.save({
      name: f.name.trim(),
      accountType: f.accountType,
      openingBalance: normalizeAmount(f.openingBalance || '0'),
      note: f.note.trim() || null,
    })
    if (!props.initial) draft.clear()
  } catch (e) {
    submitError.value = errorText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="submit">
    <FormError :message="submitError" />

    <AppField label="帳戶類型" required>
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="t in TYPES"
          :key="t"
          type="button"
          class="chip flex-col gap-1 py-2.5"
          :class="form.accountType === t ? 'chip-on' : 'chip-off'"
          :disabled="initial?.isEstimate"
          :aria-pressed="form.accountType === t"
          @click="form.accountType = t"
        >
          <span class="text-xl leading-none">{{ ACCOUNT_TYPE_ICON[t] }}</span>
          <span class="text-xs">{{ ACCOUNT_TYPE_LABEL[t] }}</span>
        </button>
      </div>
    </AppField>

    <AppField label="帳戶名稱" for="acc-name" :error="errors.name" required>
      <input id="acc-name" v-model="form.name" class="field-input" maxlength="30" placeholder="例如：台新銀行、錢包" :aria-invalid="!!errors.name || undefined">
    </AppField>

    <AppField
      :label="isCard ? '初始餘額（目前欠款請填負數）' : '初始餘額'"
      for="acc-opening"
      :error="errors.openingBalance"
      :hint="isCard ? '例如欠 5,000 元就填 -5000；之後刷卡、繳卡費會自動計算' : '建立帳戶時裡面有多少錢；之後的餘額由系統依交易計算'"
    >
      <MoneyInput id="acc-opening" v-model="form.openingBalance" :allow-negative="isCard" :invalid="!!errors.openingBalance" />
    </AppField>

    <AppField label="備註" for="acc-note" :error="errors.note">
      <input id="acc-note" v-model="form.note" class="field-input" maxlength="200" placeholder="選填">
    </AppField>

    <div class="flex justify-end gap-2 pt-1">
      <AppButton variant="secondary" :disabled="saving" @click="emit('cancel')">取消</AppButton>
      <AppButton type="submit" :loading="saving">{{ initial ? '儲存修改' : '建立帳戶' }}</AppButton>
    </div>
  </form>
</template>
