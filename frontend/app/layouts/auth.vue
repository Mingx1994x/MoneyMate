<template>
  <div class="flex min-h-screen flex-col items-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
    <div class="mb-6 flex items-center gap-2">
      <AppLogo :size="36" />
      <span class="text-xl font-bold text-slate-900">Money Mate</span>
    </div>
    <div class="w-full max-w-md">
      <slot />
    </div>
    <p class="mt-8 max-w-md text-center text-xs text-slate-400">記帳＋理財＋懶人友善。所有推算皆為估計，非投資建議。</p>
  </div>
</template>
