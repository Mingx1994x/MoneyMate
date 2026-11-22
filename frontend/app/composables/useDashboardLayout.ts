/**
 * Dashboard 自選顯示區塊（B，#117、D-A-008）。
 * - 存的是「隱藏的區塊」清單：空的就是全部顯示；之後新增的區塊不在清單裡，預設就會顯示
 * - 一句下一步、右下角「＋」固定顯示，不在這裡
 * - 報表區塊至少留一個顯示
 *
 * ⚠️ 後端 `GET`／`PUT /dashboard/layout`（E，#112）還沒完成：
 *    目前設定只存在這次開著的網頁（useState，換頁還在、重新整理會回到全部顯示）。
 *    #112 合併後，在 load()／save() 接上 API，其他地方不用改。
 */
export type DashboardBlockGroup = 'first' | 'report'

export interface DashboardBlockDef {
  /** 區塊代碼，跟後端的 hiddenBlocks 對齊（#107 提給 E 的草案，#112 確認） */
  code: string
  label: string
  group: DashboardBlockGroup
  /** 這個區塊目前有沒有畫在 Dashboard 上（A 的第一屏、趨勢圖還沒接上） */
  ready: boolean
}

export const DASHBOARD_BLOCKS: DashboardBlockDef[] = [
  { code: 'today-bills', label: '今天有什麼帳單要處理？', group: 'first', ready: false },
  { code: 'cash-gap', label: '接下來的錢夠不夠用？', group: 'first', ready: false },
  { code: 'monthly-summary', label: '本月收支', group: 'report', ready: true },
  { code: 'accounts-total', label: '帳戶合計', group: 'report', ready: true },
  { code: 'net-worth', label: '淨資產', group: 'report', ready: true },
  { code: 'upcoming-bills', label: '14 天內與逾期帳單', group: 'report', ready: true },
  { code: 'loans', label: '貸款', group: 'report', ready: true },
  { code: 'trend', label: '月收支趨勢圖', group: 'report', ready: false },
]

export function useDashboardLayout() {
  const hidden = useState<string[]>('dashboard-hidden-blocks', () => [])
  const editing = useState('dashboard-layout-editing', () => false)

  const blocks = DASHBOARD_BLOCKS.filter((b) => b.ready)
  const isVisible = (code: string) => !hidden.value.includes(code)
  const visibleReports = computed(() => blocks.filter((b) => b.group === 'report' && isVisible(b.code)))
  const hiddenBlocks = computed(() => blocks.filter((b) => !isVisible(b.code)))

  /** 報表區塊只剩這一個顯示時不能隱藏 */
  function canHide(code: string) {
    const def = blocks.find((b) => b.code === code)
    if (!def || !isVisible(code)) return false
    return def.group !== 'report' || visibleReports.value.length > 1
  }

  /** 先改畫面再存；存失敗就改回原本的設定，錯誤交給呼叫的地方顯示 */
  function save(next: string[]): Promise<void> {
    hidden.value = next
    // TODO(#112)：改成
    //   const prev = hidden.value; hidden.value = next
    //   return useApi().put('/dashboard/layout', { hiddenBlocks: next }).then(() => {}, (e) => { hidden.value = prev; throw e })
    return Promise.resolve()
  }

  function load(): Promise<void> {
    // TODO(#112)：return useApi().get<{ hiddenBlocks: string[] }>('/dashboard/layout').then((r) => { hidden.value = r.hiddenBlocks })
    return Promise.resolve()
  }

  const hide = (code: string) => (canHide(code) ? save([...hidden.value, code]) : Promise.resolve())
  const show = (code: string) => save(hidden.value.filter((c) => c !== code))

  return { blocks, hidden, editing, isVisible, canHide, hiddenBlocks, hide, show, load }
}
