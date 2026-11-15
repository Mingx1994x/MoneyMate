<script setup lang="ts">
/**
 * 30 秒財富自由問卷 —— A 負責（這是暫時版本）。PRD §12、FR-04
 * Q1 每月想花多少（預選 4 萬）；Q2 現在大概有多少存款（可跳過）。
 */
import { errorText } from '~/lib/api-error'
import { formatMoney, formatWan } from '~/lib/money'
import type { GoalProgress } from '~/types/api'

definePageMeta({ layout: 'auth' })

const api = useApi()
const { me, logout } = useAuth()

const step = ref<1 | 2 | 3>(1)
const spending = ref<number | 'custom'>(40000)
const spendingCustom = ref('')
const assets = ref<number | 'custom' | null>(null)
const assetsCustom = ref('')
const error = ref<string | null>(null)
const saving = ref(false)
const result = ref<GoalProgress | null>(null)

const Q1 = [30000, 40000, 50000, 80000]
const Q2 = [0, 100000, 500000, 1000000]

function q1Value(): number | null {
  const v = spending.value === 'custom' ? Number(spendingCustom.value) : spending.value
  return Number.isInteger(v) && v >= 1000 && v <= 333000 ? v : null
}
function next() {
  error.value = null
  if (q1Value() === null) return (error.value = '請輸入 1,000–333,000 之間的整數')
  step.value = 2
}

async function submit(skip = false) {
  error.value = null
  let currentAssets: number | undefined
  if (!skip) {
    const v = assets.value === 'custom' ? Number(assetsCustom.value) : assets.value
    if (v === null) return (error.value = '請選一個，或按「跳過」')
    if (!Number.isInteger(v) || v < 0 || v > 100_000_000) return (error.value = '請輸入 0–1 億之間的整數')
    currentAssets = v
  }
  saving.value = true
  try {
    result.value = await api.post<GoalProgress>('/onboarding', { monthlySpending: q1Value(), currentAssets })
    if (me.value) me.value = { ...me.value, hasCompletedOnboarding: true }
    step.value = 3
  } catch (e) {
    error.value = errorText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <OwnerNote owner="A" />
    <div class="card p-6 sm:p-8">
      <div class="mb-6 flex gap-1.5">
        <div v-for="i in 3" :key="i" class="h-1.5 flex-1 rounded-full" :class="i <= step ? 'bg-brand-600' : 'bg-slate-200'" />
      </div>

      <template v-if="step === 1">
        <p class="text-sm font-semibold text-brand-700">問題 1 / 2</p>
        <h1 class="mt-1 text-2xl font-bold">財富自由後，每月想花多少？</h1>
        <p class="mt-1 text-sm text-slate-500">不用很精準，之後可以改</p>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <button v-for="v in Q1" :key="v" class="chip py-4 text-lg" :class="spending === v ? 'chip-on' : 'chip-off'" @click="spending = v">{{ v / 10000 }} 萬</button>
          <button class="chip col-span-2 py-3" :class="spending === 'custom' ? 'chip-on' : 'chip-off'" @click="spending = 'custom'">自己填</button>
        </div>
        <div v-if="spending === 'custom'" class="mt-3"><MoneyInput v-model="spendingCustom" placeholder="1,000–333,000" /></div>
        <p v-if="error" class="mt-3 text-sm text-rose-600">{{ error }}</p>
        <AppButton class="mt-6" block size="lg" @click="next">下一題</AppButton>
      </template>

      <template v-else-if="step === 2">
        <p class="text-sm font-semibold text-brand-700">問題 2 / 2</p>
        <h1 class="mt-1 text-2xl font-bold">現在大概有多少存款？</h1>
        <p class="mt-1 text-sm text-slate-500">會先建立一個「現有資產（估計）」帳戶，之後新增真實帳戶時可以從這裡扣掉</p>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <button v-for="v in Q2" :key="v" class="chip py-4 text-lg" :class="assets === v ? 'chip-on' : 'chip-off'" @click="assets = v">{{ v === 0 ? '0' : `${v / 10000} 萬` }}</button>
          <button class="chip col-span-2 py-3" :class="assets === 'custom' ? 'chip-on' : 'chip-off'" @click="assets = 'custom'">自己填</button>
        </div>
        <div v-if="assets === 'custom'" class="mt-3"><MoneyInput v-model="assetsCustom" placeholder="0–100,000,000" /></div>
        <p v-if="error" class="mt-3 text-sm text-rose-600">{{ error }}</p>
        <div class="mt-6 flex gap-2">
          <AppButton variant="secondary" :disabled="saving" @click="submit(true)">跳過</AppButton>
          <AppButton block size="lg" :loading="saving" @click="submit()">看我的目標</AppButton>
        </div>
        <button class="mt-3 w-full text-center text-sm text-slate-500" @click="step = 1">← 上一題</button>
      </template>

      <template v-else-if="result">
        <p class="text-center text-4xl">🎯</p>
        <p class="mt-2 text-center text-sm text-slate-500">你的財富自由目標</p>
        <p class="num text-center text-4xl font-bold text-brand-700">{{ formatWan(result.targetAmount) }}</p>
        <p class="mt-1 text-center text-xs text-slate-500">每月花費 × 300（4% 提領率）</p>
        <div class="mt-6 rounded-2xl bg-brand-50 p-4 text-center">
          <p class="font-semibold text-brand-800">
            <template v-if="result.nextMilestone">再存 {{ formatMoney(result.nextMilestone.remaining) }} 就到第 {{ result.nextMilestone.index }} 站（{{ result.nextMilestone.label }}）！</template>
            <template v-else>你已經達成目標了！</template>
          </p>
        </div>
        <NuxtLink to="/"><AppButton class="mt-6" block size="lg">開始記帳</AppButton></NuxtLink>
      </template>
    </div>
    <button class="mt-4 w-full text-center text-sm text-slate-500" @click="logout">登出</button>
  </div>
</template>
