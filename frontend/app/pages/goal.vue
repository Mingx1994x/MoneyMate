<script setup lang="ts">
/**
 * 目標頁 —— A 負責。PRD §15.3、15.4、15.7、FR-26；AC-16、AC-17、AC-27
 * 目標金額、目前金額、還差多少、百分比、進度條、里程碑、財富自由年齡一行字、免責說明。
 * 數字全部來自 GET /goal/progress；「調整目標」先讀 GET /goal，再送 PATCH /goal。
 */
import { errorText, fieldErrors } from '~/lib/api-error'
import { formatMoney, formatWan, normalizeAmount, validateAmount } from '~/lib/money'
import type { Goal, GoalProgress, UpdateGoalBody } from '~/types/api'

const api = useApi()
const toast = useToast()
const { bump } = useDataVersion()
const r = useResource(() => api.get<GoalProgress>('/goal/progress'))
const g = computed(() => r.data.value)

// 缺資料時只問那 1 題（15.7）
const birthYear = ref('')
const saving = ref('')
const askError = ref<string | null>(null)
const asking = ref(false)
async function answer(field: 'birthYear' | 'estMonthlySaving') {
  askError.value = null
  let body: UpdateGoalBody
  if (field === 'birthYear') {
    // 只擋 1900 以前；「不能晚於今年」用台北的今年判斷，交給後端檢查（前端不自己取今天）
    const y = Number(birthYear.value)
    if (!Number.isInteger(y) || y < 1900) return (askError.value = '請輸入西元出生年，例如 1996')
    body = { birthYear: y }
  } else {
    // 第一次問只收 0 以上，手機才能跳數字鍵盤；入不敷出要填負數，從「調整目標」改
    const e = validateAmount(saving.value, { allowZero: true, label: '每月儲蓄' })
    if (e) return (askError.value = e)
    body = { estMonthlySaving: normalizeAmount(saving.value) }
  }
  asking.value = true
  try {
    await api.patch<Goal>('/goal', body)
    toast.success('已記住')
    bump()
  } catch (e) {
    // 後端欄位訊息是通用的「輸入的資料有誤」；前端已經先擋過格式，出生年會被擋下來的只剩「晚於台北的今年」
    askError.value = field === 'birthYear' && fieldErrors(e).birthYear ? '出生年不能晚於今年' : errorText(e)
  } finally {
    asking.value = false
  }
}

// 調整目標：打開時才讀 GET /goal，表單帶入目前的設定
const editing = ref<Goal | null>(null)
const formOpen = computed({ get: () => editing.value !== null, set: (v) => !v && (editing.value = null) })
const loadingGoal = ref(false)
async function openEdit() {
  loadingGoal.value = true
  try {
    editing.value = await api.get<Goal>('/goal')
  } catch (e) {
    toast.error(errorText(e))
  } finally {
    loadingGoal.value = false
  }
}
async function saveGoal(body: UpdateGoalBody) {
  await api.patch<Goal>('/goal', body)
  editing.value = null
  toast.success('目標已更新')
  bump()
}
</script>

<template>
  <div>
    <PageHeader title="財富自由目標">
      <template #actions>
        <AppButton v-if="g" :loading="loadingGoal" @click="openEdit">調整目標</AppButton>
      </template>
    </PageHeader>
    <StateView :loading="r.loading.value" :error="r.error.value" :has-data="!!g" @retry="r.reload">
      <template v-if="g">
        <!-- 財富自由年齡（15.7） -->
        <section class="card p-6">
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
            假設：<template v-if="g.fireAssumptions.age !== null">現在 {{ g.fireAssumptions.age }} 歲；</template>
            現在資產 {{ formatMoney(g.fireAssumptions.currentAssets) }}；
            年支出 {{ formatMoney(g.fireAssumptions.annualSpending) }}；
            年儲蓄 {{ g.fireAssumptions.annualSaving ? formatMoney(g.fireAssumptions.annualSaving) : '—' }}{{ g.fireAssumptions.savingSource === 'actual' ? '（近幾個月實際平均）' : g.fireAssumptions.savingSource === 'estimate' ? '（自估）' : '' }}；
            提領率 4%、投資報酬率 6%、通膨 2%，全部以今日幣值計算。
            <template v-if="Number(g.activeLoanTotal) > 0">目前資產未扣除貸款 {{ formatMoney(g.activeLoanTotal) }}。</template>
            本結果為依假設試算，非投資建議。
          </p>
        </section>

        <!-- 主數字是「再存 X 就到第 N 站」，總百分比放小字（15.4） -->
        <section class="card mt-4 p-6">
          <p class="text-sm text-slate-500">{{ g.nextMilestone ? `第 ${g.nextMilestone.index} 站：${g.nextMilestone.label}` : '已達成' }}</p>
          <p class="mt-1 text-3xl font-bold">
            <template v-if="g.nextMilestone">再存 <span class="num text-brand-700">{{ formatMoney(g.nextMilestone.remaining) }}</span></template>
            <template v-else>🎉 你已達成財富自由目標</template>
          </p>
          <p v-if="!g.achieved" class="mt-1 text-sm text-slate-500">
            離財富自由目標還差 <span class="num font-semibold text-slate-700">{{ formatMoney(g.remaining) }}</span>
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

        <p class="mt-4 text-xs leading-relaxed text-slate-500">
          目標＝財富自由後每月花費 × 300（4% 提領率）。通膨提示：假設年通膨 2%，20 年後每月 4 萬 ≈ 5.9 萬。<br>
          目標進度依啟用帳戶合計計算，包含投資帳戶和信用卡欠款，不扣除另外記錄的貸款。這個數字不等於淨資產，也不等於馬上能用的現金。本結果為估算，非投資建議。
        </p>
      </template>
    </StateView>

    <AppModal v-model:open="formOpen" title="調整目標">
      <GoalForm v-if="editing" :initial="editing" :save="saveGoal" @cancel="editing = null" />
    </AppModal>
  </div>
</template>
