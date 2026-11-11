import type { Env } from '../_lib/env'
import { json } from '../_lib/http'
import { accessToken } from '../_lib/google'

// GET /api/health — shows which server settings are present (booleans only, no secrets) and whether the service account works.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const present = {
    FIREBASE_PROJECT_ID: Boolean(env.FIREBASE_PROJECT_ID),
    FIREBASE_SERVICE_ACCOUNT: Boolean(env.FIREBASE_SERVICE_ACCOUNT),
    CLOUDINARY_CLOUD_NAME: Boolean(env.CLOUDINARY_CLOUD_NAME),
    CLOUDINARY_API_KEY: Boolean(env.CLOUDINARY_API_KEY),
    CLOUDINARY_API_SECRET: Boolean(env.CLOUDINARY_API_SECRET),
    PAYMOB_SECRET_KEY: Boolean(env.PAYMOB_SECRET_KEY),
    PAYMOB_PUBLIC_KEY: Boolean(env.PAYMOB_PUBLIC_KEY),
    PAYMOB_INTEGRATION_IDS: Boolean(env.PAYMOB_INTEGRATION_IDS),
    PAYMOB_HMAC_SECRET: Boolean(env.PAYMOB_HMAC_SECRET),
  }
  let serviceAccount: 'ok' | 'failed' | 'missing' = 'missing'
  let serviceAccountProject = ''
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccountProject = String((JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as { project_id?: string }).project_id ?? '')
      await accessToken(env)
      serviceAccount = 'ok'
    } catch { serviceAccount = 'failed' }
  }
  const projectMatches = Boolean(env.FIREBASE_PROJECT_ID) && (!serviceAccountProject || serviceAccountProject === env.FIREBASE_PROJECT_ID)
  return json({ present, serviceAccount, projectId: env.FIREBASE_PROJECT_ID ?? null, projectMatches })
}
