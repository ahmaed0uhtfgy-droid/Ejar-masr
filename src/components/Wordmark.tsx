import { BRAND, BRAND_EN } from '../lib/brand'

/** Name lock-up from the royal design: Arabic name, gold rule, spaced English line. */
export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span className="wordmark">
      <b style={small ? { fontSize: '1.2rem' } : undefined}>{BRAND}</b>
      <i />
      <span style={small ? { fontSize: 10 } : undefined}>{BRAND_EN.toUpperCase()}<em style={{ fontStyle: 'normal', color: '#d9a441' }}>.</em></span>
    </span>
  )
}
