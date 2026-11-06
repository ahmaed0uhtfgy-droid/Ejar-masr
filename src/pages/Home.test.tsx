import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../lib/firebase', () => ({ db: {}, auth: {}, firebaseConfigured: true, googleProvider: {} }))
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), query: vi.fn(), where: vi.fn(), getCountFromServer: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) }))
vi.mock('../lib/units', () => ({ latestUnits: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/settingsStore', async () => {
  const { DEFAULT_SETTINGS } = await import('../lib/defaultSettings')
  return { loadSettings: vi.fn().mockResolvedValue({ settings: DEFAULT_SETTINGS, locations: [] }) }
})

import Home from './Home'
import { SettingsProvider } from '../contexts/SettingsContext'
import { ar } from '../i18n/ar'

describe('Home', () => {
  it('is a landing page (hero, explainer, how-it-works, FAQ, CTAs), not a search page', async () => {
    render(<MemoryRouter><SettingsProvider><Home /></SettingsProvider></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(ar.home.heroTitle)
    expect(screen.getByText(ar.home.whatTitle)).toBeInTheDocument()
    expect(screen.getByText(ar.home.howTitle)).toBeInTheDocument()
    expect(screen.getByText(ar.home.faqTitle)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: ar.nav.search }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: ar.nav.add }).length).toBeGreaterThan(0)
    expect(await screen.findByText(ar.home.latestEmpty)).toBeInTheDocument()
  })
  it('does not show invented statistics when there is no data', async () => {
    render(<MemoryRouter><SettingsProvider><Home /></SettingsProvider></MemoryRouter>)
    await screen.findByText(ar.home.latestEmpty)
    expect(screen.queryByText(ar.home.statsTitle)).not.toBeInTheDocument()
  })
  it('lists all 27 governorates in the search selector', async () => {
    render(<MemoryRouter><SettingsProvider><Home /></SettingsProvider></MemoryRouter>)
    await screen.findByText(ar.home.latestEmpty)
    const select = screen.getByLabelText(ar.home.govLabel) as HTMLSelectElement
    expect(select.options.length).toBe(28)
  })
})
