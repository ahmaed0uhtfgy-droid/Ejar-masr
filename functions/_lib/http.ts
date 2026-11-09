import type { Env } from './env'
import { getDocument } from './firestore'
import { verifyIdToken } from './google'

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status)
  console.error(e)
  return json({ error: 'server', message: 'حصل خطأ في السيرفر، حاول مرة تانية' }, 500)
}

export interface AuthedUser { uid: string; data: Record<string, unknown>; isAdmin: boolean }

/** Verifies the Firebase ID token and loads the user profile. Banned or profile-less users are rejected. */
export async function requireUser(request: Request, env: Env, opts: { admin?: boolean } = {}): Promise<AuthedUser> {
  const h = request.headers.get('Authorization') ?? ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) throw new HttpError(401, 'unauthenticated', 'سجّل دخولك الأول')
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_SERVICE_ACCOUNT in Cloudflare env')
    throw new HttpError(500, 'server-misconfigured', 'إعدادات السيرفر ناقصة (FIREBASE_PROJECT_ID). راجع متغيرات Cloudflare Pages')
  }
  let uid: string
  try { uid = await verifyIdToken(token, env.FIREBASE_PROJECT_ID) } catch (e) {
    const name = e instanceof Error ? e.name : 'unknown'
    console.error('verifyIdToken failed:', name, e instanceof Error ? e.message : e)
    if (name === 'JWTExpired') throw new HttpError(401, 'token-expired', 'انتهت الجلسة، سجّل دخولك تاني')
    if (name === 'JWTClaimValidationFailed') throw new HttpError(401, 'project-mismatch', 'مشروع Firebase في السيرفر مختلف عن مشروع الموقع. راجع FIREBASE_PROJECT_ID')
    throw new HttpError(401, 'bad-token', 'تعذر التحقق من الجلسة، سجّل دخولك تاني')
  }
  const profile = await getDocument(env, `users/${uid}`)
  if (!profile) throw new HttpError(403, 'no-profile', 'الحساب غير مكتمل')
  if (profile.data.banned === true) throw new HttpError(403, 'banned', 'حسابك محظور')
  const isAdmin = profile.data.role === 'admin'
  if (opts.admin && !isAdmin) throw new HttpError(403, 'forbidden', 'مش مسموح')
  return { uid, data: profile.data, isAdmin }
}

export async function readJson<T extends Record<string, unknown>>(request: Request): Promise<T> {
  try { return (await request.json()) as T } catch { throw new HttpError(400, 'bad-json', 'طلب غير صالح') }
}
