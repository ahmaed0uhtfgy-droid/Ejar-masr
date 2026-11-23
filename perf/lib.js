// Shared settings for the k6 scripts. k6 is free: https://k6.io  (Windows: winget install k6 | macOS: brew install k6)
import { fail } from 'k6'

export const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '')
export const PROFILE = __ENV.PROFILE || 'smoke'

// You must say where to point it. There is deliberately no default, so nobody load-tests production by accident.
if (!BASE_URL) fail('Set BASE_URL, e.g.  k6 run -e BASE_URL=https://your-staging.pages.dev perf/pages.js')

// The free plans have DAILY quotas (Firestore 50k reads / 20k writes, Cloudflare Functions 100k requests). A real load test against the
// live site can use them up and take it down for the rest of the day, so anything above "smoke" needs a deliberate opt-in.
if (PROFILE !== 'smoke' && !__ENV.I_UNDERSTAND_THIS_USES_QUOTA) {
  fail('Profile "' + PROFILE + '" generates real traffic. Run it against a STAGING copy (separate Firebase project + Cloudflare preview), then add -e I_UNDERSTAND_THIS_USES_QUOTA=1')
}

const STAGES = {
  smoke: [{ duration: '30s', target: 1 }],
  load: [{ duration: '1m', target: 10 }, { duration: '3m', target: 25 }, { duration: '1m', target: 0 }],
  // Steps up until something breaks; the step where p95 / errors cross the thresholds is your limit.
  stress: [{ duration: '1m', target: 25 }, { duration: '2m', target: 50 }, { duration: '2m', target: 100 }, { duration: '2m', target: 200 }, { duration: '1m', target: 0 }],
  spike: [{ duration: '20s', target: 5 }, { duration: '10s', target: 150 }, { duration: '1m', target: 150 }, { duration: '10s', target: 5 }, { duration: '30s', target: 0 }],
}
export const stages = STAGES[PROFILE] || fail('PROFILE must be one of: ' + Object.keys(STAGES).join(', '))

export const thresholds = {
  http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: PROFILE === 'smoke' }],
  http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  checks: ['rate>0.99'],
}
