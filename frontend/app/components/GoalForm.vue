<script setup lang="ts">
/**
 * 調整目標（A）：每月花費、出生年、自估每月儲蓄，送 PATCH /goal。
 * 目標金額由後端依每月花費 × 300 重算，前端不自己算（PRD §15.3）。
 * 只送有改的欄位；自估儲蓄清空代表送 null。出生年選了就不能清回「請選擇」，不想看年齡可以在目標頁收合那張卡片。
 */
import { errorText, fieldErrors } from '~/lib/api-error'
import { normalizeAmount, toCents, validateAmount } from '~/lib/money'
import type { Goal, UpdateGoalBody } from '~/types/api'

const props = defineProps<{ initial: Goal; save: (body: UpdateGoalBody) => Promise<void> }>()
const emit = defineEmits<{ cancel: [] }>()

const form = ref({
  monthlySpending: String(Number(props.initial.monthlySpending)),
  birthYear: props.initial.birthYear === null ? '' : String(props.initial.birthYear),
  estMonthlySaving: props.initial.estMonthlySaving === null ? '' : String(Number(props.initial.estMonthlySaving)),
})

const errors = ref<Record<string, string | undefined>>({})
const submitError = ref<string | null>(null)
const saving = ref(false)

/** 每月花費與問卷 Q1 同一個範圍：整數 1,000–333,000 */
function spendingValue(): number | null {
  const v = Number(form.value.monthlySpending.trim().replace(/,/g, ''))
  return Number.isInteger(v) && v >= 1000 && v <= 333000 ? v : null
}

async function submit() {
  const f = form.value
  const spending = spendingValue()
  // 出生年用選單（BirthYearSelect），只選得到 1900 到台北的今年；還沒填過、也沒選時是 null，不會送出
  const birthYear = f.birthYear ? Number(f.birthYear) : null
  errors.value = {
    monthlySpending: spending === null ? '請輸入 1,000–333,000 之間的整數' : undefined,
    // 自估儲蓄可以是 0 或負數（入不敷出）；空白代表清空
    estMonthlySaving: f.estMonthlySaving.trim()
      ? validateAmount(f.estMonthlySaving, { allowZero: true, allowNegative: true, label: '每月儲蓄' })
      : undefined,
  }
  if (Object.values(errors.value).some(Boolean)) return

  const body: UpdateGoalBody = {}
  if (spending !== Number(props.initial.monthlySpending)) body.monthlySpending = spending!
  if (birthYear !== props.initial.birthYear) body.birthYear = birthYear
  const est = f.estMonthlySaving.trim() ? normalizeAmount(f.estMonthlySaving) : null
  const estChanged = est === null || props.initial.estMonthlySaving === null
    ? est !== props.initial.estMonthlySaving
    : toCents(est) !== toCents(props.initial.estMonthlySaving)
  if (estChanged) body.estMonthlySaving = est

  // 什麼都沒改就直接關掉，不打 API
  if (Object.keys(body).length === 0) return emit('cancel')

  saving.value = true
  submitError.value = null
  try {
    await props.save(body)
  } catch (e) {
    // 後端的欄位錯誤顯示在對應的欄位下面，其他的顯示在表單上方。
    // 後端欄位訊息是通用的「輸入的資料有誤」，換成看得懂的說明；
    // 出生年選單只到台北的今年，會被後端擋下來只剩手機時間不準、選到「晚於今年」的情況
    const fields = fieldErrors(e)
    if (fields.monthlySpending || fields.birthYear || fields.estMonthlySaving) {
      errors.value = {
        monthlySpending: fields.monthlySpending && '請輸入 1,000–333,000 之間的整數',
        birthYear: fields.birthYear && '出生年不能晚於今年',
        estMonthlySaving: fields.estMonthlySaving && '每月儲蓄格式不正確（最多 2 位小數）',
      }
    } else {
      submitError.value = errorText(e)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="submit">
    <FormError :message="submitError" />

    <AppField
      label="財富自由後，每月想花多少？"
      for="goal-spending"
      :error="errors.monthlySpending"
      hint="目標金額＝每月花費 × 300，儲存後自動重算"
      required
    >
      <MoneyInput id="goal-spending" v-model="form.monthlySpending" :invalid="!!errors.monthlySpending" />
    </AppField>

    <AppField label="出生年（西元）" for="goal-birth-year" :error="errors.birthYear" hint="用來算你幾歲財富自由">
      <BirthYearSelect id="goal-birth-year" v-model="form.birthYear" :invalid="!!errors.birthYear" />
    </AppField>

    <AppField
      label="每月大概能存多少？"
      for="goal-saving"
      :error="errors.estMonthlySaving"
      hint="記帳滿 3 個完整月後，會改用實際數字；入不敷出可以填負數"
    >
      <MoneyInput id="goal-saving" v-model="form.estMonthlySaving" allow-negative placeholder="選填" :invalid="!!errors.estMonthlySaving" />
    </AppField>

    <div class="flex justify-end gap-2 pt-1">
      <AppButton variant="secondary" :disabled="saving" @click="emit('cancel')">取消</AppButton>
      <AppButton type="submit" :loading="saving">儲存修改</AppButton>
    </div>
  </form>
</template>
