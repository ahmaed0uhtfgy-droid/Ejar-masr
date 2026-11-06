import { useRef, useState } from 'react'
import { ar } from '../i18n/ar'
import { compressToWebP, images } from '../lib/images'

interface Props { value: string[]; onChange: (v: string[]) => void; min: number; max: number }

export function ImageUploader({ value, onChange, min, max }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function pick(files: FileList | null) {
    if (!files?.length) return
    setError('')
    setBusy(true)
    const next = [...value]
    try {
      for (const f of Array.from(files)) {
        if (next.length >= max) break
        const blob = await compressToWebP(f)
        next.push(await images.upload(blob))
        onChange([...next])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : ar.errors.generic)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <p className="text-sm text-mute">{ar.form.imagesHint} ({min}–{max})</p>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {value.map((id, i) => (
          <li key={id} className="panel overflow-hidden">
            <img src={images.url(id, { w: 240, h: 180 })} alt="" width={240} height={180} className="aspect-[4/3] w-full object-cover" />
            <div className="flex flex-wrap gap-1 p-2 text-xs">
              {i === 0 ? <span className="chip">الغلاف</span> : <button type="button" className="underline" onClick={() => onChange([id, ...value.filter((x) => x !== id)])}>{ar.form.makeCover}</button>}
              <button type="button" className="ms-auto text-danger underline" onClick={() => onChange(value.filter((x) => x !== id))}>{ar.form.remove}</button>
            </div>
          </li>
        ))}
      </ul>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void pick(e.target.files)} />
      <button type="button" className="btn-ghost mt-3" disabled={busy || value.length >= max} onClick={() => input.current?.click()}>{busy ? ar.form.uploading : ar.form.addImages}</button>
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    </div>
  )
}
