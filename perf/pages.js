// Public pages under rising load: the home/search shell is a static file (served by Cloudflare's CDN, essentially free),
// while /rent/*, /unit/* and /sitemap.xml run a Pages Function and may read Firestore.
//   k6 run -e BASE_URL=https://staging.example.pages.dev perf/pages.js
//   k6 run -e BASE_URL=... -e PROFILE=stress -e I_UNDERSTAND_THIS_USES_QUOTA=1 -e UNIT_ID=<a real unit id> --summary-export=perf/results/pages.json perf/pages.js
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'
import { BASE_URL, stages, thresholds } from './lib.js'

export const options = { stages, thresholds: { ...thresholds, 'http_req_duration{kind:static}': ['p(95)<800'], 'http_req_duration{kind:function}': ['p(95)<1500'] } }

const T = { home: new Trend('t_home', true), search: new Trend('t_search', true), landing: new Trend('t_landing', true), unit: new Trend('t_unit', true), sitemap: new Trend('t_sitemap', true) }
const UNIT_ID = __ENV.UNIT_ID

function visit(path, kind, trend, expect = 200) {
  const r = http.get(BASE_URL + path, { tags: { kind, page: path.split('?')[0] } })
  trend.add(r.timings.duration)
  check(r, { [path + ' -> ' + expect]: (x) => x.status === expect, [path + ' has html/xml body']: (x) => String(x.body).length > 200 })
  return r
}

export default function () {
  visit('/', 'static', T.home)
  sleep(1 + Math.random() * 2)
  visit('/search', 'static', T.search)
  sleep(1 + Math.random() * 2)
  visit('/rent/cairo', 'function', T.landing)
  if (UNIT_ID) visit('/unit/' + UNIT_ID, 'function', T.unit)
  if (Math.random() < 0.05) visit('/sitemap.xml', 'function', T.sitemap) // crawlers, not every user
  sleep(1 + Math.random() * 3)
}
