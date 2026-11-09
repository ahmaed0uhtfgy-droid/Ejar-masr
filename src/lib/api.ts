import { auth } from './firebase'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const send = async (forceRefresh: boolean) => {
    const user = auth.currentUser
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (user) headers.Authorization = `Bearer ${await user.getIdToken(forceRefresh)}`
    return fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
  }
  let res = await send(false)
  // Expired/stale ID token: refresh once and retry before giving up.
  if (res.status === 401 && auth.currentUser) res = await send(true)
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'حصل خطأ، حاول مرة تانية')
  return data as T
}
