<script setup lang="ts">
/** 右下角「＋」快速記帳（PRD §12 每天記帳流程） */
const { state, close } = useQuickAdd()
const open = computed({ get: () => state.value.open, set: (v) => !v && close() })
const title = computed(() => ({ quick: '快速記帳', transfer: '轉帳', card: '繳卡費' })[state.value.mode])
const startKind = computed(() => (state.value.mode === 'card' ? 'card' : state.value.mode === 'transfer' ? 'transfer' : 'expense'))
// 每次打開都重新建立表單（key 變了就會重建）
const formKey = ref(0)
watch(() => state.value.open, (v) => v && formKey.value++)
</script>

<template>
  <AppModal v-model:open="open" :title="title">
    <TransactionForm :key="formKey" mode="quick" :start-kind="startKind" :card-id="state.cardId" @saved="close" @cancel="close" />
  </AppModal>
</template>
