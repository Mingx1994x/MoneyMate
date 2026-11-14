<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const notFound = computed(() => props.error.statusCode === 404)
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center px-4 text-center">
    <p class="text-5xl">{{ notFound ? '🧭' : '😵' }}</p>
    <h1 class="mt-4 text-xl font-bold">{{ notFound ? '找不到這個頁面' : '發生錯誤' }}</h1>
    <p class="mt-1 text-sm text-slate-500">{{ notFound ? '網址可能打錯了' : error.message }}</p>
    <button class="mt-6 rounded-xl bg-brand-700 px-5 py-2.5 font-semibold text-white" @click="clearError({ redirect: '/' })">回首頁</button>
  </div>
</template>
