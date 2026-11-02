import { ApiError, type ErrorDetail } from '~/lib/api-error'
import { mockRequest } from '~/mock/client'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Query = Record<string, string | number | boolean | null | undefined>

/**
 * API client。所有頁面都只透過它呼叫後端。
 * - apiMode = 'mock'：呼叫瀏覽器內的假後端（現在的 Demo）
 * - apiMode = 'http'：呼叫 NestJS（設定 NUXT_PUBLIC_API_MODE=http、NUXT_PUBLIC_API_BASE）
 * 兩種模式的路徑、欄位、錯誤格式都一樣，頁面不用改。
 */
export function useApi() {
  const config = useRuntimeConfig()
  const token = useAuthToken()
  const me = useState('auth-me')
  const route = useRoute()
  const nuxtApp = useNuxtApp()

  async function request<T>(method: Method, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const query = Object.fromEntries(
      Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    )
    try {
      if (config.public.apiMode === 'mock') {
        return await mockRequest<T>({ method, path, query, body: opts.body, token: token.value })
      }
      return await $fetch<T>(path, {
        baseURL: config.public.apiBase as string,
        method,
        query,
        body: opts.body as Record<string, unknown> | undefined,
        headers: token.value ? { Authorization: `Bearer ${token.value}` } : {},
      })
    } catch (e) {
      const err = toApiError(e)
      // 401：token 過期或無效 → 清掉並回登入頁（PRD §18）
      if (err.statusCode === 401 && !path.startsWith('/auth/login')) {
        token.value = null
        me.value = null
        if (route.path !== '/login') await nuxtApp.runWithContext(() => navigateTo('/login'))
      }
      throw err
    }
  }

  return {
    get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
    del: <T = null>(path: string, query?: Query) => request<T>('DELETE', path, { query }),
  }
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  // $fetch 的錯誤：e.data 是後端回傳的錯誤格式（docs/error-codes.md）
  const fe = e as {
    data?: {
      statusCode?: number
      code?: string
      message?: string
      details?: ErrorDetail[]
      requestId?: string
      retryAfterSeconds?: number
    }
    statusCode?: number
  }
  const d = fe?.data
  if (d?.code) {
    return new ApiError(d.statusCode ?? fe.statusCode ?? 500, d.code, d.message ?? '', Array.isArray(d.details) ? d.details : [], {
      requestId: d.requestId,
      retryAfterSeconds: d.retryAfterSeconds,
    })
  }
  // 不是後端的錯誤格式（例如部署平台回的 502／503／504）
  if (fe?.statusCode) return new ApiError(fe.statusCode, 'INTERNAL_ERROR', '系統發生錯誤，請稍後再試')
  return new ApiError(0, 'NETWORK_ERROR', '') // 文字在 ERROR_MESSAGES.NETWORK_ERROR
}
