import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../lib/firebase', () => ({ db: {}, auth: {}, firebaseConfigured: true, googleProvider: {} }))
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), query: vi.fn(), where: vi.fn(), getCountFromServer: vi.fn().mockResolvedValue({ data: () => ({ count: 12 }) }) }))
vi.mock('../lib/units', () => ({ latestUnits: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/settingsStore', async () => {
  const { DEFAULT_SETTINGS } = await import('../lib/defaultSettings')
  return { loadSettings: vi.fn().mockResolvedValue({ settings: { ...DEFAULT_SETTINGS, design: 'royal' }, locations: [] }) }
})

import Home from './Home'
import { SettingsProvider } from '../contexts/SettingsContext'
import { ar } from '../i18n/ar'

HTMLCanvasElement.prototype.getContext = (() => null) as never // jsdom has no canvas; the dust animation just skips itself

describe('Home with the royal design (set by the admin)', () => {
  it('switches the whole layout to royal, applies it to <html>, and keeps the same real content and search', async () => {
    render(<MemoryRouter><SettingsProvider><Home /></SettingsProvider></MemoryRouter>)
    await waitFor(() => expect(document.documentElement.getAttribute('data-design')).toBe('royal'))
    expect(await screen.findByLabelText(ar.home.typeLabel)).toBeInTheDocument() // the royal search bar (lazy chunk) is on screen
    expect(await screen.findByText(ar.home.latestEmpty)).toBeInTheDocument()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(ar.home.heroTitle)
    expect(screen.getByText(ar.home.whatTitle)).toBeInTheDocument()
    expect(screen.getByText(ar.home.howTitle)).toBeInTheDocument()
    expect(screen.getByText(ar.home.faqTitle)).toBeInTheDocument()
    expect((screen.getByLabelText(ar.home.govLabel) as HTMLSelectElement).options.length).toBe(28)
    expect(screen.getAllByRole('link', { name: ar.nav.add }).length).toBeGreaterThan(0)
  })
  it('shows real numbers only (no invented listings or statistics from the design mock-up)', async () => {
    render(<MemoryRouter><SettingsProvider><Home /></SettingsProvider></MemoryRouter>)
    await waitFor(() => expect(document.documentElement.getAttribute('data-design')).toBe('royal'))
    await screen.findByText(ar.home.latestEmpty)
    expect(document.body.textContent).not.toMatch(/3,200|18,500|12,000|\+5,000/)
    expect(await screen.findByText(ar.home.statsUnits)).toBeInTheDocument()
  })
})
