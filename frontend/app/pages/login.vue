<script setup lang="ts">
/** 登入頁（B）— PRD US-01、FR-02 */
import { errorText } from '~/lib/api-error'
import { DEMO_EMAIL, DEMO_PASSWORD } from '~/mock/seed'

definePageMeta({ layout: 'auth' })

const { login } = useAuth()
const config = useRuntimeConfig()
const isMock = config.public.apiMode === 'mock'

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const errors = ref<{ email?: string; password?: string }>({})
const error = ref<string | null>(null)
const loading = ref(false)

async function submit() {
  errors.value = {
    email: !email.value.trim() ? '請輸入 Email' : undefined,
    password: !password.value ? '請輸入密碼' : undefined,
  }
  if (errors.value.email || errors.value.password) return
  loading.value = true
  error.value = null
  try {
    const user = await login(email.value, password.value)
    await navigateTo(user.hasCompletedOnboarding ? '/' : '/onboarding')
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

async function demoLogin() {
  email.value = DEMO_EMAIL
  password.value = DEMO_PASSWORD
  await submit()
}
</script>

<template>
  <div class="card p-6 sm:p-8">
    <h1 class="text-2xl font-bold">登入</h1>
    <p class="mt-1 text-sm text-slate-500">歡迎回來 Money Mate</p>

    <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
      <FormError :message="error" />
      <AppField label="Email" for="email" :error="errors.email">
        <input id="email" v-model="email" type="email" autocomplete="email" inputmode="email" class="field-input" :aria-invalid="!!errors.email || undefined">
      </AppField>
      <AppField label="密碼" for="password" :error="errors.password">
        <div class="relative">
          <input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" class="field-input pr-16" :aria-invalid="!!errors.password || undefined">
          <button type="button" class="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-slate-500" @click="showPassword = !showPassword">{{ showPassword ? '隱藏' : '顯示' }}</button>
        </div>
      </AppField>
      <AppButton type="submit" block size="lg" :loading="loading">登入</AppButton>
    </form>

    <p class="mt-5 text-center text-sm text-slate-600">
      還沒有帳號？<NuxtLink to="/register" class="font-semibold text-brand-700">註冊</NuxtLink>
    </p>

    <div v-if="isMock" class="mt-6 rounded-2xl border border-dashed border-brand-500/50 bg-brand-50 p-4">
      <p class="text-sm font-semibold text-brand-800">想直接看看？</p>
      <p class="mt-0.5 text-xs text-brand-700">Demo 帳號已經有半年的記帳資料、帳單和貸款（{{ DEMO_EMAIL }} / {{ DEMO_PASSWORD }}）</p>
      <AppButton class="mt-3" variant="soft" block :loading="loading" @click="demoLogin">用 Demo 帳號登入</AppButton>
    </div>
  </div>
</template>
