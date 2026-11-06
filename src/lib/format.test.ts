import { PHONE_RE, addDays, isExpired, toWhatsAppNumber } from './format'

describe('format helpers', () => {
  it('normalises Egyptian numbers for wa.me', () => {
    expect(toWhatsAppNumber('01012345678')).toBe('201012345678')
    expect(toWhatsAppNumber('+20 101 234 5678')).toBe('201012345678')
    expect(toWhatsAppNumber('0020 101 234 5678')).toBe('201012345678')
  })
  it('validates phone numbers', () => {
    expect(PHONE_RE.test('01012345678')).toBe(true)
    expect(PHONE_RE.test('abc')).toBe(false)
    expect(PHONE_RE.test('123')).toBe(false)
  })
  it('detects expiry', () => {
    const now = new Date('2026-11-06T00:00:00Z')
    expect(isExpired(null, now)).toBe(false)
    expect(isExpired(addDays(now, 1), now)).toBe(false)
    expect(isExpired(addDays(now, -1), now)).toBe(true)
  })
})
