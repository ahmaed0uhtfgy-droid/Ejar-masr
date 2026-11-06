import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'jose'
import type { Env } from './env'

let cached: { token: string; exp: number } | null = null

/** OAuth access token for the Firebase service account (cached per isolate). Secret lives in Cloudflare env, never in code. */
export async function accessToken(env: Env): Promise<string> {
  if (cached && cached.exp - 60_000 > Date.now()) return cached.token
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as { client_email: string; private_key: string }
  const key = await importPKCS8(sa.private_key, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email).setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(key)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 }
  return cached.token
}

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))

/** Verifies a Firebase ID token (signature, issuer, audience, expiry) and returns the uid. */
export async function verifyIdToken(token: string, projectId: string): Promise<string> {
  const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${projectId}`, audience: projectId })
  if (!payload.sub) throw new Error('no sub')
  return payload.sub
}
