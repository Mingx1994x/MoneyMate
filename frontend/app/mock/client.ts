import { ApiError } from '../lib/api-error'
import { FAIL_KEY } from './db'
import { MockServer, type MockRequest } from './server'

let server: MockServer | null = null

export function mockServer(): MockServer {
  if (!server) server = new MockServer(window.localStorage)
  return server
}

export function isSimulatingFailure(): boolean {
  try {
    return localStorage.getItem(FAIL_KEY) === '1'
  } catch {
    return false
  }
}

export function setSimulateFailure(on: boolean) {
  if (on) localStorage.setItem(FAIL_KEY, '1')
  else localStorage.removeItem(FAIL_KEY)
}

/** 模擬網路延遲；開啟「模擬失敗」時，所有寫入都回 500 且不改資料 */
export async function mockRequest<T>(req: MockRequest): Promise<T> {
  await new Promise((r) => setTimeout(r, req.method === 'GET' ? 120 : 280))
  if (req.method !== 'GET' && isSimulatingFailure() && !req.path.startsWith('/auth')) {
    throw new ApiError(500, 'INTERNAL_ERROR', '模擬的伺服器錯誤')
  }
  const result = mockServer().handle(req)
  return (result === null || result === undefined ? null : JSON.parse(JSON.stringify(result))) as T
}
