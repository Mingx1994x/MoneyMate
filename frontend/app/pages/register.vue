<script setup lang="ts">
/**
 * 註冊頁（B）— PRD US-01、FR-02；後端 POST /auth/register
 * 註冊成功後自動登入（後端回 accessToken），新使用者一律先去問卷頁。
 * 前端驗證只為體驗，規則跟後端 RegisterDto 一致；後端回的欄位錯誤（details）顯示在對應欄位下面。
 */
import { errorText, fieldErrors } from '~/lib/api-error'
import { validateEmail } from '~/lib/email'

definePageMeta({ layout: 'auth' })

const { register, homePath } = useAuth()
const email = ref('')
const password = ref('')
const displayName = ref('')
const showPassword = ref(false)
const errors = ref<{ email?: string; password?: string; displayName?: string }>({})
const error = ref<string | null>(null)
const loading = ref(false)

// 後端規則：Email 只接受 ASCII（~/lib/email）；密碼 8 字元以上、72 bytes 以內（bcrypt 上限，一個中文字佔 3 bytes）
const passwordBytes = computed(() => new TextEncoder().encode(password.value).length)

function validate() {
  errors.value = {
    email: validateEmail(email.value),
    password:
      password.value.length < 8 ? '密碼至少 8 個字元' : passwordBytes.value > 72 ? '密碼太長了（中文字每個算 3 個字元，上限 72）' : undefined,
    displayName: displayName.value.trim().length > 30 ? '名稱最多 30 個字' : undefined,
  }
  return !Object.values(errors.value).some(Boolean)
}

async function submit() {
  if (loading.value || !validate()) return
  loading.value = true
  error.value = null
  try {
    const user = await register(email.value.trim(), password.value, displayName.value.trim())
    await navigateTo(homePath(user))
  } catch (e) {
    const byField = fieldErrors(e)
    if (Object.keys(byField).length) errors.value = { ...errors.value, ...byField }
    else error.value = errorText(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="card p-6 sm:p-8">
    <h1 class="text-2xl font-bold">建立帳號</h1>
    <p class="mt-1 text-sm text-slate-500">註冊後花 30 秒回答 2 個問題，就能看到你的財富自由目標</p>

    <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
      <FormError :message="error" />
      <AppField label="Email" for="email" :error="errors.email" required>
        <input id="email" v-model="email" type="email" autocomplete="email" inputmode="email" class="field-input" :aria-invalid="!!errors.email || undefined">
      </AppField>
      <AppField label="密碼" for="password" :error="errors.password" hint="至少 8 個字元" required>
        <div class="relative">
          <input id="password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" class="field-input pr-16" :aria-invalid="!!errors.password || undefined">
          <button type="button" class="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-slate-500" @click="showPassword = !showPassword">{{ showPassword ? '隱藏' : '顯示' }}</button>
        </div>
      </AppField>
      <AppField label="怎麼稱呼你" for="name" :error="errors.displayName" hint="選填；沒填就用 Email 前半">
        <input id="name" v-model="displayName" autocomplete="nickname" maxlength="30" class="field-input">
      </AppField>
      <AppButton type="submit" block size="lg" :loading="loading">註冊</AppButton>
    </form>

    <p class="mt-5 text-center text-sm text-slate-600">
      已經有帳號？<NuxtLink to="/login" class="font-semibold text-brand-700">登入</NuxtLink>
    </p>
  </div>
</template>
