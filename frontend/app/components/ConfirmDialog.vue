<script setup lang="ts">
const { state, answer } = useConfirm()
const open = computed({
  get: () => state.value.open,
  set: (v) => {
    if (!v) answer(false)
  },
})
</script>

<template>
  <AppModal v-model:open="open" :title="state.title" top>
    <p v-if="state.message" class="text-sm whitespace-pre-line text-slate-600">{{ state.message }}</p>
    <div class="mt-6 flex justify-end gap-2">
      <AppButton variant="secondary" @click="answer(false)">{{ state.cancelText ?? '取消' }}</AppButton>
      <AppButton :variant="state.danger ? 'danger' : 'primary'" @click="answer(true)">{{ state.confirmText ?? '確定' }}</AppButton>
    </div>
  </AppModal>
</template>
