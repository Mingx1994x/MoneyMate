<script setup lang="ts">
/** 共用版型（A 負責，這是暫時版本）：桌面左側欄、手機底部導覽、右下角「＋」快速記帳 */
import { isSimulatingFailure, mockServer, setSimulateFailure } from '~/mock/client'

const route = useRoute()
const { displayName, me, logout } = useAuth()
const quick = useQuickAdd()
const { bump } = useDataVersion()
const { confirm } = useConfirm()
const toast = useToast()
const config = useRuntimeConfig()
const isMock = config.public.apiMode === 'mock'

const NAV = [
  { to: '/', label: '總覽', icon: '🏠' },
  { to: '/transactions', label: '交易', icon: '🧾' },
  { to: '/bills', label: '帳單', icon: '📅' },
  { to: '/accounts', label: '帳戶', icon: '🏦' },
  { to: '/loans', label: '貸款', icon: '📄' },
  { to: '/goal', label: '目標', icon: '🎯' },
]
const MOBILE_NAV = NAV.filter((n) => n.to !== '/goal' && n.to !== '/loans')
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to))

// ---------- Demo 工具 ----------
const toolsOpen = ref(false)
const failing = ref(false)
onMounted(() => (failing.value = isMock && isSimulatingFailure()))
function toggleFail() {
  failing.value = !failing.value
  setSimulateFailure(failing.value)
  toast.info(failing.value ? '已開啟：所有儲存都會失敗（測試錯誤畫面）' : '已關閉模擬失敗')
}
async function resetDemo() {
  const ok = await confirm({ title: '重設 Demo 資料？', message: 'Demo 帳號的資料會回到初始狀態。你自己註冊的帳號不受影響。', confirmText: '重設' })
  if (!ok) return
  mockServer().resetDemo()
  bump()
  toast.success('Demo 資料已重設')
  toolsOpen.value = false
}
async function resetAll() {
  const ok = await confirm({ title: '清除所有資料？', message: '這個瀏覽器裡的所有帳號與資料都會刪除（只影響你自己的瀏覽器）。', confirmText: '全部清除', danger: true })
  if (!ok) return
  mockServer().resetAll()
  await logout()
}
</script>

<template>
  <div class="min-h-screen pb-24 md:pb-0">
    <!-- Demo 提示 -->
    <div v-if="isMock" class="bg-slate-900 px-4 py-1.5 text-center text-xs text-slate-200 md:pl-60">
      Demo 版：還沒連後端，資料只存在<strong>你自己的瀏覽器</strong>裡。
      <button class="ml-1 underline" @click="toolsOpen = true">Demo 工具</button>
    </div>

    <!-- 桌面側欄 -->
    <aside class="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-slate-200 bg-white md:flex">
      <NuxtLink to="/" class="flex items-center gap-2 px-5 py-5">
        <AppLogo :size="32" />
        <span class="text-lg font-bold text-slate-900">Money Mate</span>
      </NuxtLink>
      <nav class="flex flex-col gap-1 px-3">
        <NuxtLink
          v-for="n in NAV"
          :key="n.to"
          :to="n.to"
          class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition"
          :class="isActive(n.to) ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100'"
        >
          <span class="text-base">{{ n.icon }}</span>{{ n.label }}
        </NuxtLink>
      </nav>
      <div class="px-3 pt-4">
        <AppButton block @click="quick.open()">＋ 記一筆</AppButton>
      </div>
      <div class="mt-auto border-t border-slate-200 p-4 text-sm">
        <p class="truncate font-semibold text-slate-800">{{ displayName }}</p>
        <p class="truncate text-xs text-slate-500">{{ me?.email }}</p>
        <div class="mt-2 flex gap-3 text-xs">
          <button v-if="isMock" class="text-slate-500 hover:text-slate-800" @click="toolsOpen = true">Demo 工具</button>
          <button class="text-slate-500 hover:text-slate-800" @click="logout">登出</button>
        </div>
      </div>
    </aside>

    <!-- 手機頂部 -->
    <header class="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
      <NuxtLink to="/" class="flex items-center gap-2">
        <AppLogo :size="28" />
        <span class="font-bold">Money Mate</span>
      </NuxtLink>
      <div class="flex items-center gap-1">
        <NuxtLink to="/loans" class="rounded-lg px-2 py-1 text-sm font-semibold" :class="isActive('/loans') ? 'text-brand-700' : 'text-slate-600'">貸款</NuxtLink>
        <NuxtLink to="/goal" class="rounded-lg px-2 py-1 text-sm font-semibold" :class="isActive('/goal') ? 'text-brand-700' : 'text-slate-600'">目標</NuxtLink>
        <button class="rounded-lg px-2 py-1 text-sm text-slate-500" aria-label="選單" @click="toolsOpen = true">⋯</button>
      </div>
    </header>

    <main class="md:pl-56">
      <div class="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <slot />
      </div>
    </main>

    <!-- 手機底部導覽 -->
    <nav class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <NuxtLink
        v-for="n in MOBILE_NAV"
        :key="n.to"
        :to="n.to"
        class="flex flex-col items-center gap-0.5 py-2 text-xs font-semibold"
        :class="isActive(n.to) ? 'text-brand-700' : 'text-slate-500'"
      >
        <span class="text-lg leading-none">{{ n.icon }}</span>{{ n.label }}
      </NuxtLink>
    </nav>

    <!-- 右下角「＋」快速記帳 -->
    <button
      class="fixed right-5 bottom-20 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-3xl text-white shadow-lg shadow-brand-700/30 transition hover:bg-brand-800 active:scale-95 md:right-8 md:bottom-8"
      aria-label="快速記帳"
      @click="quick.open()"
    >
      ＋
    </button>

    <QuickAdd />

    <!-- Demo 工具／手機選單 -->
    <AppModal v-model:open="toolsOpen" title="選單">
      <div class="space-y-3 text-sm">
        <div class="rounded-xl bg-slate-50 p-3">
          <p class="font-semibold">{{ displayName }}</p>
          <p class="text-xs text-slate-500">{{ me?.email }}</p>
        </div>
        <template v-if="isMock">
          <p class="pt-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Demo 工具（只在 Demo 版出現）</p>
          <label class="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
            <span>
              <span class="font-semibold">模擬儲存失敗</span>
              <span class="block text-xs text-slate-500">測試「儲存失敗時顯示錯誤、不假裝成功」（PRD §8）</span>
            </span>
            <input type="checkbox" class="h-5 w-5 accent-brand-700" :checked="failing" @change="toggleFail">
          </label>
          <AppButton variant="secondary" block @click="resetDemo">重設 Demo 帳號的資料</AppButton>
          <AppButton variant="ghost" block class="text-rose-600" @click="resetAll">清除這個瀏覽器的所有資料</AppButton>
        </template>
        <AppButton variant="secondary" block @click="logout">登出</AppButton>
      </div>
    </AppModal>
  </div>
</template>
