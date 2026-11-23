// API behaviour under load WITHOUT touching business data:
//  - /api/health                      (one Firebase token exchange per cold start)
//  - anonymous calls to protected APIs (must be rejected fast, before any database read)
//  - forged payment callbacks          (must be rejected by the HMAC check: this is the endpoint an attacker can hammer)
// Optional: -e ID_TOKEN=<a Firebase ID token of a test user> also exercises /api/sign-upload (1 Firestore read per call).
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE_URL, stages, thresholds } from './lib.js'

export const options = { stages, thresholds: { ...thresholds, http_req_duration: ['p(95)<800', 'p(99)<2000'] } }
const JSON_H = { headers: { 'Content-Type': 'application/json' } }
const TOKEN = __ENV.ID_TOKEN

export default function () {
  const health = http.get(BASE_URL + '/api/health', { tags: { ep: 'health' } })
  check(health, { 'health 200': (r) => r.status === 200 })

  const anon = http.post(BASE_URL + '/api/reveal', JSON.stringify({ unitId: 'aaaaaaaaaaaa' }), { ...JSON_H, tags: { ep: 'anon-reveal' } })
  check(anon, { 'anonymous reveal -> 401': (r) => r.status === 401 })

  const forged = http.post(BASE_URL + '/api/pay-webhook?hmac=' + '0'.repeat(128), JSON.stringify({ type: 'TRANSACTION', obj: { id: 1, success: true, amount_cents: 100, order: { id: 1 } } }), { ...JSON_H, tags: { ep: 'forged-webhook' } })
  check(forged, { 'forged webhook -> 401': (r) => r.status === 401 })

  if (TOKEN) {
    const s = http.post(BASE_URL + '/api/sign-upload', '{}', { headers: { ...JSON_H.headers, Authorization: 'Bearer ' + TOKEN }, tags: { ep: 'sign-upload' } })
    check(s, { 'sign-upload 200': (r) => r.status === 200 })
  }
  sleep(0.5 + Math.random())
}
