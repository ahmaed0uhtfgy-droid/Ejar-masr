import { STATIC_COUNTS, STATIC_TREE, buildLocations } from './locations'

describe('locations', () => {
  it('matches the documented size of the egydata dataset (27 governorates, 389 areas)', () => {
    expect(STATIC_COUNTS).toEqual({ governorates: 27, areas: 389 })
    expect(STATIC_TREE.govs).toHaveLength(27)
    expect(Object.values(STATIC_TREE.areasByGov).flat()).toHaveLength(389)
  })
  it('every area points at an existing governorate', () => {
    for (const a of Object.values(STATIC_TREE.areaById)) expect(STATIC_TREE.govById[a.govId]).toBeDefined()
  })
  it('applies admin additions, renames and deletions', () => {
    const gov = STATIC_TREE.govs[0]
    const area = STATIC_TREE.areasByGov[gov.id][0]
    const t = buildLocations([
      { id: 'x2_new', level: 2, parentId: gov.id, name: 'مركز جديد' },
      { id: 'x3_v', level: 3, parentId: 'x2_new', name: 'قرية الاختبار' },
      { id: area.id, level: 2, parentId: gov.id, name: area.name, deleted: true },
    ])
    expect(t.areasByGov[gov.id].some((a) => a.id === 'x2_new')).toBe(true)
    expect(t.localitiesByArea['x2_new']?.[0].name).toBe('قرية الاختبار')
    expect(t.areaById[area.id]).toBeUndefined()
  })
  it('drops children of a deleted governorate', () => {
    const gov = STATIC_TREE.govs[0]
    const t = buildLocations([{ id: gov.id, level: 1, parentId: null, name: gov.name, deleted: true }])
    expect(t.govById[gov.id]).toBeUndefined()
    expect(t.areasByGov[gov.id]).toBeUndefined()
  })
})
