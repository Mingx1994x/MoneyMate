<script setup lang="ts">
/**
 * 目標頁 —— A 負責（這是暫時版本）。
 * 目標金額、目前金額、還差多少、百分比、進度條、里程碑、財富自由年齡一行字、免責說明（PRD §15.3、15.4、15.7）。
 */
import { errorText } from '~/lib/api-error'
import { formatMoney, formatWan, normalizeAmount, validateAmount } from '~/lib/money'
import type { GoalProgress } from '~/types/api'

const api = useApi()
const toast = useToast()
const { bump } = useDataVersion()
const r = useResource(() => api.get<GoalProgress>('/goal/progress'))
const g = computed(() => r.data.value)

// 缺資料時只問那 1 題
const birthYear = ref('')
const saving = ref('')
const askError = ref<string | null>(null)
const asking = ref(false)
async function answer(field: 'birthYear' | 'estMonthlySaving') {
  askError.value = null
  let body: Record<string, unknown>
  if (field === 'birthYear') {
    const y = Number(birthYear.value)
    if (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear()) return (askError.value = '請輸入西元出生年，例如 1996')
    body = { birthYear: y }
  } else {
    const e = validateAmount(saving.value, { allowZero: true })
    if (e) return (askError.value = e)
    body = { estMonthlySaving: normalizeAmount(saving.value) }
  }
  asking.value = true
  try {
    await api.patch('/goal', body)
    toast.success('已記住')
    bump()
  } catch (e) {
    askError.value = errorText(e)
  } finally {
    asking.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="財富自由目標" />
    <OwnerNote owner="A" />
    <StateView :loading="r.loading.value" :error="r.error.value" :has-data="!!g" @retry="r.reload">
      <template v-if="g">
        <section class="card p-6">
          <p class="text-sm text-slate-500">{{ g.nextMilestone ? `第 ${g.nextMilestone.index} 站：${g.nextMilestone.label}` : '已達成' }}</p>
          <p class="mt-1 text-3xl font-bold">
            <template v-if="g.nextMilestone">再存 <span class="num text-brand-700">{{ formatMoney(g.nextMilestone.remaining) }}</span></template>
            <template v-else>🎉 你已達成財富自由目標</template>
          </p>
          <div class="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-brand-600 transition-all" :style="{ width: `${Math.max(g.percent, 1)}%` }" />
          </div>
          <div class="mt-2 flex justify-between text-sm text-slate-600">
            <span>目前 <strong class="num">{{ formatMoney(g.currentAmount) }}</strong></span>
            <span>{{ g.percent }}%</span>
            <span>目標 <strong class="num">{{ formatWan(g.targetAmount) }}</strong></span>
          </div>
        </section>

        <section class="card mt-4 p-6">
          <h2 class="font-semibold">里程碑</h2>
          <ol class="mt-3 space-y-2">
            <li v-for="m in g.milestones" :key="m.index" class="flex items-center gap-3">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold" :class="m.reached ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'">
                {{ m.reached ? '✓' : m.index }}
              </span>
              <span class="flex-1">{{ m.label }}</span>
              <span class="num text-sm font-semibold">{{ formatWan(m.amount) }}</span>
            </li>
          </ol>
        </section>

        <!-- 財富自由年齡（15.7） -->
        <section class="card mt-4 p-6">
          <template v-if="g.fireAgeStatus === 'ok'">
            <p class="text-lg">照現在的速度，你可以在 <strong class="text-2xl text-brand-700">{{ g.fireAge }} 歲</strong>財富自由</p>
          </template>
          <p v-else-if="g.fireAgeStatus === 'achieved'" class="text-lg font-semibold">你已經財富自由了 🎉</p>
          <p v-else-if="g.fireAgeStatus === 'unreachable'" class="text-lg">以目前收支無法達成</p>
          <p v-else-if="g.fireAgeStatus === 'over_100'" class="text-lg">以目前速度，100 歲前無法達成</p>
          <div v-else-if="g.fireAgeStatus === 'need_birth_year'">
            <p class="font-semibold">補上出生年，就能算出你幾歲財富自由</p>
            <form class="mt-3 flex gap-2" @submit.prevent="answer('birthYear')">
              <input v-model="birthYear" inputmode="numeric" class="field-input max-w-40" placeholder="例如 1996">
              <AppButton type="submit" :loading="asking">送出</AppButton>
            </form>
          </div>
          <div v-else-if="g.fireAgeStatus === 'need_saving'">
            <p class="font-semibold">你現在每月大概能存多少？</p>
            <p class="text-sm text-slate-500">記帳滿 3 個完整月後，會改用實際數字</p>
            <form class="mt-3 flex gap-2" @submit.prevent="answer('estMonthlySaving')">
              <div class="max-w-48"><MoneyInput v-model="saving" /></div>
              <AppButton type="submit" :loading="asking">送出</AppButton>
            </form>
          </div>
          <p v-if="askError" class="mt-2 text-sm text-rose-600">{{ askError }}</p>
          <p class="mt-3 text-xs leading-relaxed text-slate-500">
            假設：年支出 {{ formatMoney(g.fireAssumptions.annualSpending) }}；
            年儲蓄 {{ g.fireAssumptions.annualSaving ? formatMoney(g.fireAssumptions.annualSaving) : '—' }}{{ g.fireAssumptions.savingSource === 'actual' ? '（近幾個月實際平均）' : g.fireAssumptions.savingSource === 'estimate' ? '（自估）' : '' }}；
            提領率 4%、投資報酬率 6%、通膨 2%，全部以今日幣值計算。
            <template v-if="Number(g.activeLoanTotal) > 0">目前資產未扣除貸款 {{ formatMoney(g.activeLoanTotal) }}。</template>
            本結果為依假設試算，非投資建議。
          </p>
        </section>

        <p class="mt-4 text-xs leading-relaxed text-slate-500">
          目標＝財富自由後每月花費 × 300（4% 提領率）。通膨提示：假設年通膨 2%，20 年後每月 4 萬 ≈ 5.9 萬。<br>
          目標進度依啟用帳戶合計計算，包含投資帳戶和信用卡欠款，不扣除另外記錄的貸款。這個數字不等於淨資產，也不等於馬上能用的現金。本結果為估算，非投資建議。
        </p>
      </template>
    </StateView>
  </div>
</template>
