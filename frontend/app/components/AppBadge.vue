<script setup lang="ts">
const props = withDefaults(defineProps<{ tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'violet' }>(), { tone: 'gray' })
const cls = computed(
  () =>
    ({
      gray: 'bg-slate-100 text-slate-700',
      green: 'bg-emerald-100 text-emerald-800',
      amber: 'bg-amber-100 text-amber-800',
      red: 'bg-rose-100 text-rose-800',
      blue: 'bg-sky-100 text-sky-800',
      violet: 'bg-violet-100 text-violet-800',
    })[props.tone],
)
</script>

<template>
  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap" :class="cls"><slot /></span>
</template>
