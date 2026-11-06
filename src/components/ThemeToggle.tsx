import { useState } from 'react'
import { ar } from '../i18n/ar'
import { getTheme, setTheme, type Theme } from '../lib/theme'

export function ThemeToggle() {
  const [theme, set] = useState<Theme>(getTheme())
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="btn-ghost !px-3"
      aria-label={theme === 'dark' ? ar.theme.toLight : ar.theme.toDark}
      title={theme === 'dark' ? ar.theme.toLight : ar.theme.toDark}
      onClick={() => { setTheme(next); set(next) }}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  )
}
