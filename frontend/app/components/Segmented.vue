<script setup lang="ts" generic="T extends string">
/** 分段按鈕（取代下拉選單，少一次點擊） */
const model = defineModel<T>({ required: true })
defineProps<{ options: { value: T; label: string }[]; label?: string }>()
</script>

<template>
  <div class="grid gap-1 rounded-xl bg-slate-100 p-1" :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }" role="radiogroup" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      class="rounded-lg px-2 py-1.5 text-sm font-semibold transition"
      :class="model === o.value ? 'bg-white text-slate-900 shadow' : 'text-slate-500 hover:text-slate-700'"
      @click="model = o.value"
    >
      {{ o.label }}
    </button>
  </div>
</template>
