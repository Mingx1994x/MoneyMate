<script setup lang="ts">
/** 金額輸入：手機跳數字鍵盤；v-model 是字串（API 金額也是字串） */
const model = defineModel<string>({ required: true })
withDefaults(
  defineProps<{ id?: string; invalid?: boolean; allowNegative?: boolean; size?: 'md' | 'xl'; placeholder?: string; autofocus?: boolean }>(),
  { size: 'md', placeholder: '0' },
)

function onInput(e: Event) {
  // 只留數字、小數點、負號
  const el = e.target as HTMLInputElement
  model.value = el.value.replace(/[^\d.\-]/g, '')
}
</script>

<template>
  <div class="relative">
    <span
      class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-semibold text-slate-400"
      :class="size === 'xl' ? 'text-xl' : 'text-sm'"
    >NT$</span>
    <input
      :id="id"
      :value="model"
      type="text"
      :inputmode="allowNegative ? 'text' : 'decimal'"
      autocomplete="off"
      :placeholder="placeholder"
      :aria-invalid="invalid || undefined"
      :autofocus="autofocus"
      class="field-input num"
      :class="size === 'xl' ? 'py-4 pl-16 text-3xl font-bold' : 'pl-12'"
      @input="onInput"
    >
  </div>
</template>
