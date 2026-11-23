/**
 * Security headers for every response served by Pages Functions (see functions/_middleware.ts).
 * Static files get the same values from public/_headers (a test keeps the two in sync), because Cloudflare does not apply
 * _headers to Function responses and does not run Functions for static assets.
 *
 * The CSP is sent as REPORT-ONLY on purpose: it was written from reading the code (Firebase Auth/Firestore, Cloudinary, OpenStreetMap
 * tiles, Google Fonts) and could not be tried in a real browser. Watch the browser console for "[Report Only]" messages while you
 * use sign-up, Google sign-in, the map, image upload and payment; when it is clean, rename the header to Content-Security-Policy.
 *
 * Cross-Origin-Opener-Policy is deliberately NOT set: "same-origin" breaks the Google sign-in popup.
 */

/** sha256 of the inline theme script in index.html (it prevents a dark-mode flash). Recompute if that script changes (a test checks it). */
export const THEME_SCRIPT_HASH = "'sha256-vBxvsvGPYDDjNR9jdf4PGZGDtTdXGI5bsi7UF2K+L7k='"

export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${THEME_SCRIPT_HASH} https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://static.cloudflareinsights.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://res.cloudinary.com https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://*.googleusercontent.com",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://api.cloudinary.com https://nominatim.openstreetmap.org https://cloudflareinsights.com",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://apis.google.com https://www.google.com/recaptcha/ https://recaptcha.google.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000',
}

/** Returns a copy of the response with the security headers added (existing headers set by a handler are never overwritten). */
export function withSecurityHeaders(res: Response): Response {
  const h = new Headers(res.headers)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!h.has(k)) h.set(k, v)
  if ((h.get('Content-Type') ?? '').includes('text/html') && !h.has('Content-Security-Policy-Report-Only')) h.set('Content-Security-Policy-Report-Only', CSP)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
}
