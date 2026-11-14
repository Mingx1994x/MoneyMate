/** Toast、確認視窗、資料重新整理通知 —— 全站共用的小工具 */

export interface Toast {
  id: number
  text: string
  tone: 'success' | 'error' | 'info'
}

let toastSeq = 0
export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])
  function show(text: string, tone: Toast['tone'] = 'success') {
    const id = ++toastSeq
    toasts.value = [...toasts.value, { id, text, tone }]
    setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), tone === 'error' ? 5000 : 2600)
  }
  return {
    toasts,
    success: (t: string) => show(t, 'success'),
    error: (t: string) => show(t, 'error'),
    info: (t: string) => show(t, 'info'),
  }
}

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}
interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve?: (v: boolean) => void
}

/** const ok = await confirm({ title: '確定刪除？' }) */
export function useConfirm() {
  const state = useState<ConfirmState>('confirm', () => ({ open: false, title: '' }))
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      state.value = { ...opts, open: true, resolve }
    })
  }
  function answer(v: boolean) {
    state.value.resolve?.(v)
    state.value = { ...state.value, open: false, resolve: undefined }
  }
  return { state, confirm, answer }
}

/** 任何寫入成功後呼叫 bump()，有在看資料的頁面就會重新載入 */
export function useDataVersion() {
  const version = useState('data-version', () => 0)
  return { version, bump: () => version.value++ }
}

/** 快速記帳視窗的開關（右下角「＋」） */
export function useQuickAdd() {
  const state = useState<{ open: boolean; mode: 'quick' | 'transfer' | 'card'; cardId?: string }>('quick-add', () => ({
    open: false,
    mode: 'quick',
  }))
  return {
    state,
    open: (mode: 'quick' | 'transfer' | 'card' = 'quick', cardId?: string) => (state.value = { open: true, mode, cardId }),
    close: () => (state.value = { ...state.value, open: false }),
  }
}
