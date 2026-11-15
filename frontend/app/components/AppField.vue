<script setup lang="ts">
/** 表單欄位外框：標籤、必填星號、錯誤訊息或提示 */
defineProps<{
  label: string
  for?: string
  error?: string | null
  hint?: string
  required?: boolean
}>()
</script>

<template>
  <div class="space-y-1.5">
    <label :for="$props.for" class="block text-sm font-medium text-slate-700">
      {{ label }}<span v-if="required" class="ml-0.5 text-rose-600">*</span>
    </label>
    <slot />
    <p v-if="error" class="text-sm text-rose-600" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-slate-500">{{ hint }}</p>
  </div>
</template>
