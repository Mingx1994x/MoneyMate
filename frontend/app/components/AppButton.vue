<script setup lang="ts">
/** 共用按鈕。variant：primary／secondary／danger／ghost；loading 時自動鎖住，避免連點 */
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'soft'
    size?: 'sm' | 'md' | 'lg'
    type?: 'button' | 'submit'
    loading?: boolean
    disabled?: boolean
    block?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button' },
)

const cls = computed(() => [
  'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold whitespace-nowrap transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
  {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3.5 text-base',
  }[props.size],
  {
    primary: 'bg-brand-700 text-white shadow-sm hover:bg-brand-800',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    ghost: 'text-slate-600 hover:bg-slate-100',
    soft: 'bg-brand-50 text-brand-800 hover:bg-brand-100',
  }[props.variant],
  props.block ? 'w-full' : '',
])
</script>

<template>
  <button :type="type" :class="cls" :disabled="disabled || loading">
    <svg v-if="loading" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    </svg>
    <slot />
  </button>
</template>
