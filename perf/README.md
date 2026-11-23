# Performance tests (k6)

k6 is free and open source. Install: Windows `winget install k6`, macOS `brew install k6`, Linux see https://k6.io/docs/get-started/installation/.

| Profile | What it does | Where it is allowed |
|---|---|---|
| `smoke` | 1 user for 30 s. Proves the scripts and the site work. | anywhere, including the live site |
| `load` | 10 -> 25 users for 5 min (a normal busy day). | staging only |
| `stress` | 25 -> 200 users in steps. The step where errors or p95 cross the thresholds is your limit. | staging only |
| `spike` | 5 -> 150 users in 10 s (a viral post). | staging only |

```bash
# 1. Is everything wired up? (safe on production)
k6 run -e BASE_URL=https://ejar-masr1.pages.dev perf/pages.js
k6 run -e BASE_URL=https://ejar-masr1.pages.dev perf/api.js

# 2. Find the limit (on a STAGING copy)
k6 run -e BASE_URL=https://staging.pages.dev -e PROFILE=stress -e I_UNDERSTAND_THIS_USES_QUOTA=1 -e UNIT_ID=<a real unit id> --summary-export=perf/results/pages.json perf/pages.js
```

## Why not stress the live site?
The free plans have **daily** quotas, not just speed limits: Firestore 50,000 reads and 20,000 writes per day, Cloudflare Functions 100,000 requests per day.
A 10-minute stress test can burn a day's quota and the real site then shows the "daily limit reached" notice to real users until the quota resets.
Create a second free Firebase project + a Cloudflare preview deployment for tests.

## Reading the result
`http_req_duration p(95)` is the time 95% of requests finish within. Compare per tag (`kind:static` vs `kind:function`, or `ep:...`).
- Static pages slow down only when the CDN does, which on Cloudflare means almost never: if they slow down, suspect your own network.
- `kind:function` pages and the APIs are limited by (1) Cloudflare's 10 ms CPU per request on the free plan, (2) Firestore round-trips, (3) daily quotas.
  Errors with status 429/1015 are Cloudflare rate limiting; 500 with "quota" means Firestore's daily limit; `exceeded CPU` means the 10 ms limit.
