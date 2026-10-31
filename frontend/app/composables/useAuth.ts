import type { AuthResponse, Me } from '~/types/api'

const TOKEN_KEY = 'moneymate-token'

/**
 * 跟使用者有關、登出時要清掉的 localStorage 資料：表單草稿（useDraft）、上次選的帳戶與分類（useMemory）。
 * 這些 key 沒有區分使用者，同一台電腦輪流登入時，不清掉的話下一個人會看到上一個人沒送出的內容（PR #14 Aidd 實測）。
 * 重新整理、關分頁不會清，PRD 第三節「允許中斷」的行為不受影響。
 */
const USER_KEY_PREFIXES = ['moneymate-draft:', 'moneymate-mem:']

function clearUserStorage() {
  try {
    Object.keys(localStorage)
      .filter((k) => USER_KEY_PREFIXES.some((p) => k.startsWith(p)))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* 無痕模式等情況，忽略 */
  }
}

/** token 存在 localStorage（PRD §19：重新整理後仍登入，登出時清除） */
export function useAuthToken() {
  const token = useState<string | null>('auth-token', () => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  })
  return computed({
    get: () => token.value,
    set: (v: string | null) => {
      token.value = v
      try {
        if (v) localStorage.setItem(TOKEN_KEY, v)
        else localStorage.removeItem(TOKEN_KEY)
      } catch {
        /* 無痕模式等情況，忽略 */
      }
    },
  })
}

export function useAuth() {
  const token = useAuthToken()
  const me = useState<Me | null>('auth-me', () => null)
  const api = useApi()

  async function fetchMe() {
    me.value = await api.get<Me>('/auth/me')
    return me.value
  }

  async function login(email: string, password: string) {
    const r = await api.post<AuthResponse>('/auth/login', { email, password })
    token.value = r.accessToken
    me.value = r.user
    return r.user
  }

  async function register(email: string, password: string, displayName?: string) {
    const r = await api.post<AuthResponse>('/auth/register', { email, password, displayName: displayName || undefined })
    token.value = r.accessToken
    me.value = r.user
    return r.user
  }

  async function logout() {
    token.value = null
    me.value = null
    clearUserStorage()
    await navigateTo('/login')
  }

  const displayName = computed(() => me.value?.displayName || me.value?.email.split('@')[0] || '')

  return { token, me, displayName, fetchMe, login, register, logout }
}
