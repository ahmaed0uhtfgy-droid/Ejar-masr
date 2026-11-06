import type { Env } from '../_lib/env'
import { errorResponse, json, requireUser } from '../_lib/http'
import { cloudinarySignature } from '../_lib/logic'

// POST /api/sign-upload  (Authorization: Bearer <Firebase ID token>)
// Returns signed params so the browser can upload straight to Cloudinary. No open unsigned preset.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireUser(request, env)
    const params = { allowed_formats: 'jpg,jpeg,png,webp', folder: `units/${user.uid}`, timestamp: Math.floor(Date.now() / 1000) }
    const signature = await cloudinarySignature(params, env.CLOUDINARY_API_SECRET)
    return json({ cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, timestamp: params.timestamp, folder: params.folder, allowedFormats: params.allowed_formats, signature })
  } catch (e) { return errorResponse(e) }
}
