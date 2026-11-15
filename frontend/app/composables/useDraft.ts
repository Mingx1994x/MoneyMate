/**
 * 表單草稿：沒送出的內容存在 localStorage，下次打開還在（PRD 核心原則「允許中斷」）。
 * ⚠️ 不要用在密碼欄位。
 */
export function useDraft<T extends Record<string, unknown>>(key: string, initial: () => T) {
  const storageKey = `moneymate-draft:${key}`
  const hasDraft = ref(false)
  const values = ref(load()) as Ref<T>

  function load(): T {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        hasDraft.value = true
        return { ...initial(), ...JSON.parse(raw) }
      }
    } catch {
      /* ignore */
    }
    return initial()
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    values,
    (v) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(v))
        } catch {
          /* ignore */
        }
      }, 300)
    },
    { deep: true },
  )

  function clear() {
    clearTimeout(timer)
    hasDraft.value = false
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
    values.value = initial()
  }

  return { values, hasDraft, clear }
}

/** 記住使用者上次的選擇（帳戶、分類），以及分類的使用次數 */
export function useMemory() {
  const read = (k: string) => {
    try {
      return localStorage.getItem(`moneymate-mem:${k}`)
    } catch {
      return null
    }
  }
  const write = (k: string, v: string) => {
    try {
      localStorage.setItem(`moneymate-mem:${k}`, v)
    } catch {
      /* ignore */
    }
  }
  const categoryUsage = (): Record<string, number> => {
    try {
      return JSON.parse(read('category-usage') ?? '{}')
    } catch {
      return {}
    }
  }
  return {
    lastAccountId: () => read('last-account'),
    setLastAccountId: (id: string) => write('last-account', id),
    lastCategoryId: (type: string) => read(`last-category-${type}`),
    setLastCategoryId: (type: string, id: string) => write(`last-category-${type}`, id),
    categoryUsage,
    bumpCategory(id: string) {
      const u = categoryUsage()
      u[id] = (u[id] ?? 0) + 1
      write('category-usage', JSON.stringify(u))
    },
  }
}
