<script setup lang="ts">
const { toasts } = useToast()
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
    <TransitionGroup
      enter-active-class="transition duration-200"
      enter-from-class="-translate-y-2 opacity-0"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg"
        :class="{
          'bg-slate-900 text-white': t.tone === 'success',
          'bg-rose-600 text-white': t.tone === 'error',
          'bg-white text-slate-800 ring-1 ring-slate-200': t.tone === 'info',
        }"
      >
        {{ t.tone === 'success' ? '✓ ' : '' }}{{ t.text }}
      </div>
    </TransitionGroup>
  </div>
</template>
