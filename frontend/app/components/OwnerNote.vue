<script setup lang="ts">
/** 標示「這塊不是 B 負責、目前是暫時版本」，方便開會時討論分工 */
defineProps<{ owner: string; text?: string }>()
</script>

<template>
  <div class="mb-4 flex items-start gap-2 rounded-xl border border-dashed border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-800">
    <span class="shrink-0 font-bold whitespace-nowrap">{{ owner }} 負責</span>
    <span>{{ text ?? '目前是 B 做的暫時版本，方便串起 Demo 流程，之後由負責人改寫。' }}</span>
  </div>
</template>
