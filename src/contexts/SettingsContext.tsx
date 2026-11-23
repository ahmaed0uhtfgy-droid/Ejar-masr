import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import { applyDesign, currentDesign, type DesignId } from '../lib/design'
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
  /** The design on screen: the admin's temporary preview if there is one, else the saved one (the one already on <html> until settings arrive). */
  design: DesignId
  /** Admin > المظهر: try a design on the whole site without saving it (null = back to the saved one). */
  previewDesign(d: DesignId | null): void
  reload(): Promise<void>
  markQuota(): void
}

const Ctx = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [locItems, setLocItems] = useState<LocItem[]>([])
  const [ready, setReady] = useState(false)
  const [quotaExceeded, setQuota] = useState(false)
  const [preview, setPreview] = useState<DesignId | null>(null)
  const [known, setKnown] = useState(false) // true once the settings were really read (a failed read must not flip a returning visitor to the default design)

  const reload = useCallback(async () => {
    try {
      const r = await loadSettings(true)
      setSettings(r.settings); setLocItems(r.locations); setKnown(true)
    } catch (e) { if (isQuotaError(e)) setQuota(true) }
    setReady(true)
  }, [])

  useEffect(() => {
    loadSettings()
      .then((r) => { setSettings(r.settings); setLocItems(r.locations); setKnown(true) })
      .catch((e) => { if (isQuotaError(e)) setQuota(true) })
      .finally(() => setReady(true))
  }, [])

  // Until the settings arrive, trust what the inline script in index.html already put on <html> (no flash); then the saved design wins.
  const design: DesignId = preview ?? (known ? settings.design : currentDesign())
  useEffect(() => { if (known || preview) applyDesign(design, !preview) }, [design, known, preview])

  const locations = useMemo(() => (locItems.length ? buildLocations(locItems) : STATIC_TREE), [locItems])
  const value = useMemo(() => ({ settings, locItems, locations, ready, quotaExceeded, design, previewDesign: setPreview, reload, markQuota: () => setQuota(true) }), [settings, locItems, locations, ready, quotaExceeded, design, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettings outside SettingsProvider')
  return v
}
