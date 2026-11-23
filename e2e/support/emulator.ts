/** Helpers that talk to the LOCAL Firebase emulators only (never to a real project). */
const PROJECT = process.env.E2E_FIREBASE_PROJECT ?? 'demo-ejar-e2e'
const FS = `http://127.0.0.1:8080`
const AUTH = `http://127.0.0.1:9099`

export async function clearEmulators(): Promise<void> {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
}

type Plain = string | number | boolean
const typed = (v: Plain) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })

/** Writes a document bypassing security rules ("Bearer owner" is the emulator's admin token). */
export async function seedDoc(path: string, data: Record<string, Plain>): Promise<void> {
  const res = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typed(v)])) }),
  })
  if (!res.ok) throw new Error(`seed ${path} failed: ${res.status} ${await res.text()}`)
}

/** The ad form needs at least `minImages` pictures; image upload needs Cloudinary, so tests run with 0 required. */
export const allowAdsWithoutImages = (): Promise<void> => seedDoc('settings/app', { minImages: 0, maxImages: 10, defaultAdDays: 0 })

let n = 0
export const uniqueEmail = (tag: string): string => `${tag}-${Date.now()}-${n++}@example.test`
