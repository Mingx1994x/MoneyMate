<script setup lang="ts">
/**
 * Dashboard 的一個可隱藏區塊（B，#117）。編輯版面時右上角出現「隱藏」；
 * 報表只剩這一個時按鈕停用，提示至少要留一個。
 */
const props = defineProps<{ code: string }>()
const layout = useDashboardLayout()
const toast = useToast()
const label = computed(() => layout.blocks.find((b) => b.code === props.code)?.label ?? '')

async function hide() {
  try {
    await layout.hide(props.code)
  } catch {
    toast.error('沒有存到，請再試一次')
  }
}
</script>

<template>
  <div v-if="layout.isVisible(code)" class="relative" :class="layout.editing.value ? 'rounded-2xl outline-2 outline-offset-2 outline-dashed outline-slate-300' : ''">
    <slot />
    <div v-if="layout.editing.value" class="absolute right-3 top-3">
      <AppButton
        size="sm"
        variant="secondary"
        :disabled="!layout.canHide(code)"
        :title="layout.canHide(code) ? `隱藏「${label}」` : '報表至少要留一個區塊'"
        :aria-label="`隱藏「${label}」`"
        @click="hide"
      >
        隱藏
      </AppButton>
    </div>
  </div>
</template>
