import { errCode, errDetail, isPermissionError, isQuotaError } from './errors'

describe('error helpers', () => {
  it('errCode reads a string code from any object, and is empty otherwise', () => {
    expect(errCode({ code: 'auth/invalid-credential' })).toBe('auth/invalid-credential')
    expect(errCode({ code: 42 })).toBe('42')
    for (const v of [null, undefined, 'x', 5, {}, new Error('x')]) expect(errCode(v)).toBe('')
  })
  it('detects the Firestore daily-quota error by code or by message', () => {
    expect(isQuotaError({ code: 'resource-exhausted' })).toBe(true)
    expect(isQuotaError({ code: 'firestore/resource-exhausted' })).toBe(true)
    expect(isQuotaError(new Error('Quota exceeded for read requests'))).toBe(true)
    expect(isQuotaError(new Error('network down'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })
  it('detects permission errors', () => { expect(isPermissionError({ code: 'permission-denied' })).toBe(true); expect(isPermissionError({ code: 'not-found' })).toBe(false) })
  it('errDetail is one short line, safe for any input', () => {
    expect(errDetail(Object.assign(new Error('boom\n  happened'), { code: 'x/y' }))).toBe('x/y boom happened')
    expect(errDetail('plain')).toBe('plain'); expect(errDetail(undefined)).toBe('')
    expect(errDetail(new Error('x'.repeat(5000))).length).toBeLessThanOrEqual(900)
  })
})
