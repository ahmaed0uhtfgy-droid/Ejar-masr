/**
 * Test double for functions/_lib/google.ts (no network, no `jose`).
 * Tests mock the real module with this file:  vi.mock('../_lib/google', () => import('../_tests/fakeGoogle'))
 *
 * Tokens are plain strings:  "uid:<uid>"  -> verifies as that user,  "expired" -> JWTExpired,  anything else -> invalid.
 */
export async function accessToken(): Promise<string> { return 'fake-service-account-token' }

export async function verifyIdToken(token: string, projectId: string): Promise<string> {
  if (token === 'expired') throw Object.assign(new Error('"exp" claim timestamp check failed'), { name: 'JWTExpired' })
  if (token === 'wrong-project') throw Object.assign(new Error(`unexpected "aud" claim value (expected ${projectId})`), { name: 'JWTClaimValidationFailed' })
  if (token.startsWith('uid:') && token.length > 4) return token.slice(4)
  throw Object.assign(new Error('signature verification failed'), { name: 'JWSSignatureVerificationFailed' })
}
