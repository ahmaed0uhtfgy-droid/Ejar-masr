// Generates src/data/locations.json from the open-source `egydata` package (MIT).
// Level 1: governorate, level 2: city/district. Level 3 (villages/neighbourhoods) is admin-managed.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { governorates, cities } = require('egydata')
const govs = governorates.getAll().map((g) => ({ id: `g${g.id}`, code: g.code, name: g.name, nameEn: g.nameEn }))
const subs = []
for (const g of governorates.getAll()) {
  for (const c of cities.getByGovernorate(g.code)) {
    subs.push({ id: `c${c.id}`, govId: `g${g.id}`, name: c.name, nameEn: c.nameEn })
  }
}
writeFileSync('src/data/locations.json', JSON.stringify({ source: 'egydata (MIT)', governorates: govs, areas: subs }))
console.log(`governorates=${govs.length} areas=${subs.length}`)
