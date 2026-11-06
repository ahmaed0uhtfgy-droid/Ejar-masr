// Generates firestore.indexes.json for the search queries (status [+ governorate] [+ rentType] x sort).
import { writeFileSync } from 'node:fs'
const sorts = [['createdAt', 'DESCENDING'], ['price', 'ASCENDING'], ['price', 'DESCENDING']]
const eq = [[], ['governorateId'], ['rentType'], ['governorateId', 'rentType']]
const indexes = []
for (const e of eq) for (const [f, d] of sorts) {
  indexes.push({
    collectionGroup: 'units', queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'status', order: 'ASCENDING' }, ...e.map((x) => ({ fieldPath: x, order: 'ASCENDING' })), { fieldPath: f, order: d }],
  })
}
indexes.push({ collectionGroup: 'units', queryScope: 'COLLECTION', fields: [{ fieldPath: 'ownerId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }] })
writeFileSync('firestore.indexes.json', JSON.stringify({ indexes, fieldOverrides: [] }, null, 2))
console.log(`indexes=${indexes.length}`)
