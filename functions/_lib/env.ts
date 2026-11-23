import { DEFAULT_SITE_URL } from '../../src/lib/brand'

export interface Env {
  ASSETS: Fetcher
  FIREBASE_PROJECT_ID: string
  FIREBASE_SERVICE_ACCOUNT: string
  CLOUDINARY_CLOUD_NAME: string
  CLOUDINARY_API_KEY: string
  CLOUDINARY_API_SECRET: string
  SITE_URL?: string
  /** Optional, comma-separated previous domains (e.g. "old.example.com,https://other.pages.dev"): links to them inside articles are shown with the current domain. */
  OLD_SITE_URLS?: string
  PAYMOB_SECRET_KEY?: string
  PAYMOB_PUBLIC_KEY?: string
  PAYMOB_INTEGRATION_IDS?: string // comma-separated card/wallet integration ids
  PAYMOB_HMAC_SECRET?: string
  CRON_SECRET?: string // protects POST /api/sweep (daily job)
  RESEND_API_KEY?: string // transactional email (resend.com free tier)
  EMAIL_FROM?: string // e.g. "إيجار مصر <noreply@your-domain.com>"
  ANTHROPIC_API_KEY?: string // article writer (Claude): best Arabic quality, pay per use
  GEMINI_API_KEY?: string // article writer (Google Gemini): has a free tier
  AI_PROVIDER?: string // 'anthropic' | 'gemini' (default: whichever key is set, Gemini first)
  AI_MODEL?: string
  /** Optional, Gemini only: how much the model may "think" before answering. A level name (minimal | low | medium | high) or a token budget number (0 = off). Unset = the model's own default. */
  AI_THINKING?: string
  /** Optional: seconds to wait for the AI to write one article (default 85, allowed 30-280). Raise it for slower, higher-quality models. */
  AI_TIMEOUT_SECONDS?: string // optional model override
}
/**
 * Public address of the site. Tolerates a SITE_URL typed without "https://" (e.g. "ejar-masr1.pages.dev") or with a trailing slash:
 * a scheme-less value used to produce an invalid "Sitemap:" line in robots.txt and broken canonical / Open Graph URLs.
 */
export const siteUrl = (env: Env): string => {
  const raw = (env.SITE_URL ?? '').trim().replace(/\/+$/, '')
  if (!raw) return DEFAULT_SITE_URL
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

/** Every address the site used to have: the built-in default plus OLD_SITE_URLS. Used to keep old links inside articles pointing at the current domain. */
export const previousSiteUrls = (env: Env): string[] => [DEFAULT_SITE_URL, ...(env.OLD_SITE_URLS ?? '').split(',')].map((x) => x.trim()).filter(Boolean)
