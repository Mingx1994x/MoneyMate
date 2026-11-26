<script setup lang="ts">
/**
 * 出生年選單（A）：台北的今年到 1900，新的在前；和後端 PATCH /goal 接受的範圍一樣，
 * 使用者選不到超過今年的年份。v-model 是字串，空字串（「請選擇」）代表還沒有出生年。
 * 選了年份之後「請選擇」就不能再選，出生年只能改成別的年份，不能清空。
 */
import { parse, todayTaipei } from '~/lib/date'

const model = defineModel<string>({ required: true })
defineProps<{ id?: string; invalid?: boolean }>()

const thisYear = parse(todayTaipei()).y
const years = Array.from({ length: thisYear - 1900 + 1 }, (_, i) => String(thisYear - i))
</script>

<template>
  <select :id="id" v-model="model" class="field-input" :aria-invalid="invalid || undefined">
    <option value="" :disabled="model !== ''">請選擇</option>
    <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
  </select>
</template>
