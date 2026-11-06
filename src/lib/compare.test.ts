import { MAX_COMPARE, addToCompare, removeFromCompare } from './compare'

describe('compare list', () => {
  it('caps at three and de-duplicates', () => {
    expect(addToCompare('a')).toBe('added')
    expect(addToCompare('a')).toBe('exists')
    addToCompare('b'); addToCompare('c')
    expect(addToCompare('d')).toBe('full')
    expect(JSON.parse(localStorage.getItem('ejar:compare') ?? '[]')).toHaveLength(MAX_COMPARE)
    removeFromCompare('a')
    expect(addToCompare('d')).toBe('added')
  })
})
