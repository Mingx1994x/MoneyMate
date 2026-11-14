import { errorText } from '~/lib/api-error'
import type { Account, Category, ListResponse } from '~/types/api'

/**
 * 讀取資料的共用寫法：loading / error / data / reload。
 * 資料版本（useDataVersion）變動時自動重新載入，所以快速記帳後各頁數字會立刻更新。
 */
export function useResource<T>(loader: () => Promise<T>, opts: { immediate?: boolean; watch?: unknown[] } = {}) {
  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(true)
  const error = ref<string | null>(null)
  const { version } = useDataVersion()

  async function reload() {
    loading.value = true
    error.value = null
    try {
      data.value = await loader()
    } catch (e) {
      error.value = errorText(e)
    } finally {
      loading.value = false
    }
  }

  watch([version, ...((opts.watch ?? []) as never[])], () => void reload(), { deep: true })
  if (opts.immediate !== false) onMounted(reload)

  return { data, loading, error, reload }
}

/** 帳戶與分類（多個表單都要用） */
export function useLookups() {
  const api = useApi()
  const accounts = useResource(() => api.get<ListResponse<Account>>('/accounts', { includeInactive: true }).then((r) => r.items))
  const categories = useResource(() => api.get<ListResponse<Category>>('/categories').then((r) => r.items))

  /** 可以用來記帳的帳戶：啟用中、不是估計帳戶 */
  const usableAccounts = computed(() => (accounts.data.value ?? []).filter((a) => a.isActive && !a.isEstimate))
  const accountName = (id: string | null | undefined) => (accounts.data.value ?? []).find((a) => a.id === id)?.name ?? '（已刪除的帳戶）'
  const categoryName = (id: string | null | undefined) => (categories.data.value ?? []).find((c) => c.id === id)?.name ?? '—'
  const categoriesOf = (type: 'income' | 'expense') => (categories.data.value ?? []).filter((c) => c.type === type)

  return { accounts, categories, usableAccounts, accountName, categoryName, categoriesOf }
}
