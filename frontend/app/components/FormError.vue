<script setup lang="ts">
defineProps<{ message: string | null }>()
</script>

<template>
  <div v-if="message" class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700" role="alert">
    {{ message }}
  </div>
</template>
