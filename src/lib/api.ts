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
  const user = auth.currentUser
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'حصل خطأ، حاول مرة تانية')
  return data as T
}
