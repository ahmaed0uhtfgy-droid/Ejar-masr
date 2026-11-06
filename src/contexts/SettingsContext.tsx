import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import { STATIC_TREE, buildLocations, type LocationTree } from '../lib/locations'
import { loadSettings } from '../lib/settingsStore'
import { isQuotaError } from '../lib/errors'
import type { AppSettings, LocItem } from '../lib/types'

interface SettingsState {
  settings: AppSettings
  locItems: LocItem[]
  locations: LocationTree
  ready: boolean
  quotaExceeded: boolean
  reload(): Promise<void>
  markQuota(): void
}

const Ctx = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [locItems, setLocItems] = useState<LocItem[]>([])
  const [ready, setReady] = useState(false)
  const [quotaExceeded, setQuota] = useState(false)

  const reload = useCallback(async () => {
    try {
      const r = await loadSettings(true)
      setSettings(r.settings); setLocItems(r.locations)
    } catch (e) { if (isQuotaError(e)) setQuota(true) }
    setReady(true)
  }, [])

  useEffect(() => {
    loadSettings()
      .then((r) => { setSettings(r.settings); setLocItems(r.locations) })
      .catch((e) => { if (isQuotaError(e)) setQuota(true) })
      .finally(() => setReady(true))
  }, [])

  const locations = useMemo(() => (locItems.length ? buildLocations(locItems) : STATIC_TREE), [locItems])
  const value = useMemo(() => ({ settings, locItems, locations, ready, quotaExceeded, reload, markQuota: () => setQuota(true) }), [settings, locItems, locations, ready, quotaExceeded, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettings outside SettingsProvider')
  return v
}
