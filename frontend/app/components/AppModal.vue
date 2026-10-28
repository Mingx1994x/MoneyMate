<script setup lang="ts">
/** 對話框：手機從底部滑出、桌面置中；按 Esc 或背景可關閉 */
const open = defineModel<boolean>('open', { required: true })
withDefaults(defineProps<{ title: string; wide?: boolean; top?: boolean }>(), {})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4"
        :class="top ? 'z-[70]' : 'z-50'"
        @click.self="open = false"
      >
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          class="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6"
          :class="wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'"
        >
          <div class="mb-4 flex items-center justify-between gap-4">
            <h2 class="text-lg font-bold text-slate-900">{{ title }}</h2>
            <button class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="關閉" @click="open = false">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 5.3a1 1 0 0 0-1.4 1.4L8.6 10l-3.7 3.3a1 1 0 1 0 1.4 1.4L10 11.4l3.3 3.3a1 1 0 0 0 1.4-1.4L11.4 10l3.3-3.3a1 1 0 0 0-1.4-1.4L10 8.6 6.3 5.3Z" /></svg>
            </button>
          </div>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
