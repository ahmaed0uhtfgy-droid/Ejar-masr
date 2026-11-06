export interface Env {
  ASSETS: Fetcher
  FIREBASE_PROJECT_ID: string
  FIREBASE_SERVICE_ACCOUNT: string
  CLOUDINARY_CLOUD_NAME: string
  CLOUDINARY_API_KEY: string
  CLOUDINARY_API_SECRET: string
  SITE_URL?: string
}
export const siteUrl = (env: Env): string => env.SITE_URL ?? 'https://ejar-masr.pages.dev'
