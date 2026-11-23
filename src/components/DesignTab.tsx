import { useEffect, useState } from 'react'
import { ar } from '../i18n/ar'
import { useSettings } from '../contexts/SettingsContext'
import { useToast } from '../contexts/ToastContext'
import { logAudit } from '../lib/audit'
import { DESIGNS, DESIGN_IDS, type DesignId } from '../lib/designIds'
import { saveSettings } from '../lib/settingsStore'

/**
 * Admin > المظهر: choose which of the two designs the whole site uses.
 * Picking a card previews it on the entire site (only in this browser, nothing is saved); "حفظ ونشر" writes settings/app.design.
 */
export function DesignTab() {
  const { settings, design, previewDesign, reload } = useSettings()
  const toast = useToast()
  const [sel, setSel] = useState<DesignId>(settings.design)
  const [busy, setBusy] = useState(false)
  useEffect(() => setSel(settings.design), [settings.design])
  useEffect(() => () => previewDesign(null), [previewDesign]) // leaving the tab ends an unsaved preview

  const dirty = sel !== settings.design

  function choose(id: DesignId) { setSel(id); previewDesign(id === settings.design ? null : id) }
  function cancel() { setSel(settings.design); previewDesign(null) }

  async function save() {
    setBusy(true)
    try {
      await saveSettings({ ...settings, design: sel })
      await logAudit('settings.design', 'settings', 'app', { before: { design: settings.design }, after: { design: sel } })
      await reload() // fresh read; the saved design is now settings.design
      previewDesign(null)
      toast.ok(ar.admin.designSaved)
    } catch { toast.err(ar.errors.generic) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl">{ar.admin.designTitle}</h2>
        <p className="mt-1 max-w-2xl text-mute">{ar.admin.designHint}</p>
      </div>
      <div role="radiogroup" aria-label={ar.admin.designTitle} className="grid gap-5 md:grid-cols-2">
        {DESIGN_IDS.map((id) => {
          const d = DESIGNS[id]
          const picked = sel === id
          return (
            <button key={id} type="button" role="radio" aria-checked={picked} onClick={() => choose(id)}
              className={`panel overflow-hidden text-start transition-shadow ${picked ? 'ring-4 ring-nile' : 'hover:border-nile'}`}>
              <div className="flex h-56 items-center justify-center" style={{ background: id === 'royal' ? 'radial-gradient(ellipse at 50% 55%, #1a4a96 0, #0a2145 45%, #061431 80%)' : '#F6F2E8' }}>
                <img src={d.preview} alt="" className="h-full w-auto object-contain" style={id === 'classic' ? { mixBlendMode: 'multiply' } : undefined} loading="lazy" />
              </div>
              <div className="space-y-1 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg">{d.name}</span>
                  <span className="chip">{d.tagline}</span>
                  {settings.design === id && <span className="chip border-nile text-nile">{ar.admin.designLive}</span>}
                </div>
                <p className="text-sm text-mute">{d.description}</p>
                <p className="pt-1 text-sm font-medium text-nile">{picked ? `✓ ${ar.admin.designSelected}` : ar.admin.designChoose}</p>
              </div>
            </button>
          )
        })}
      </div>
      {dirty && design === sel && <p className="panel border-sand p-3 text-sm" role="status">{ar.admin.designPreviewing}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" disabled={!dirty || busy} onClick={() => void save()}>{ar.admin.designSave}</button>
        {dirty && <button type="button" className="btn-ghost" disabled={busy} onClick={cancel}>{ar.admin.designCancel}</button>}
      </div>
    </div>
  )
}
