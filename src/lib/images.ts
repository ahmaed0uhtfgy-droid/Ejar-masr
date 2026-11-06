import { apiPost } from './api'

/** Provider-agnostic image layer. Swap `cloudinaryProvider` for another implementation to change vendor. */
export interface ImageProvider {
  upload(file: Blob): Promise<string> // returns an opaque image id stored in Firestore
  url(id: string, opts?: { w?: number; h?: number }): string
}

interface SignResponse { cloudName: string; apiKey: string; timestamp: number; folder: string; allowedFormats: string; signature: string }

const MAX_BYTES = 1_500_000
const MAX_DIM = 1600

export async function compressToWebP(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP')
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  let q = 0.82
  for (let i = 0; i < 4; i++) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', q))
    if (blob && blob.size <= MAX_BYTES) return blob
    q -= 0.15
  }
  throw new Error('حجم الصورة كبير حتى بعد الضغط. جرّب صورة أصغر')
}

export const cloudinaryProvider: ImageProvider = {
  async upload(file) {
    const sig = await apiPost<SignResponse>('/api/sign-upload', {})
    const form = new FormData()
    form.append('file', file)
    form.append('api_key', sig.apiKey)
    form.append('timestamp', String(sig.timestamp))
    form.append('folder', sig.folder)
    form.append('allowed_formats', sig.allowedFormats)
    form.append('signature', sig.signature)
    const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, { method: 'POST', body: form })
    if (!res.ok) throw new Error('فشل رفع الصورة')
    const data = (await res.json()) as { public_id: string }
    // store "cloudName:publicId" so URLs can be built without extra config
    return `${sig.cloudName}:${data.public_id}`
  },
  url(id, opts) {
    const [cloud, ...rest] = id.split(':')
    const pid = rest.join(':')
    const t = ['f_auto', 'q_auto', opts?.w ? `w_${opts.w}` : '', opts?.h ? `h_${opts.h}` : '', opts?.w && opts?.h ? 'c_fill' : opts?.w ? 'c_limit' : '']
      .filter(Boolean)
      .join(',')
    return `https://res.cloudinary.com/${cloud}/image/upload/${t}/${pid}`
  },
}

export const images: ImageProvider = cloudinaryProvider
