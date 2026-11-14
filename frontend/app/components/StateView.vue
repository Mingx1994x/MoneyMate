<script setup lang="ts">
/**
 * 載入中／錯誤／空狀態三合一。
 * <StateView :loading="r.loading" :error="r.error" :empty="list.length === 0" empty-title="還沒有帳單" @retry="r.reload">
 *   ...有資料時的內容
 * </StateView>
 */
defineProps<{
  loading: boolean
  error: string | null
  empty?: boolean
  emptyTitle?: string
  emptyText?: string
  hasData?: boolean
}>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="loading && !hasData" class="space-y-3 py-6" aria-busy="true">
    <div v-for="i in 3" :key="i" class="h-14 animate-pulse rounded-xl bg-slate-100" />
  </div>
  <div v-else-if="error" class="py-12 text-center">
    <p class="text-3xl">😵</p>
    <p class="mt-2 font-semibold text-rose-700">無法載入資料</p>
    <p class="mt-1 text-sm text-slate-500">{{ error }}</p>
    <AppButton variant="secondary" class="mt-4" @click="$emit('retry')">重試</AppButton>
  </div>
  <div v-else-if="empty" class="py-12 text-center">
    <p class="text-3xl">🌱</p>
    <p class="mt-2 font-semibold text-slate-700">{{ emptyTitle ?? '這裡還沒有資料' }}</p>
    <p v-if="emptyText" class="mt-1 text-sm text-slate-500">{{ emptyText }}</p>
    <div class="mt-4"><slot name="empty-action" /></div>
  </div>
  <slot v-else />
</template>
