import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId)

// Placeholder values keep the app bootable (home/static pages) when env vars are missing.
const app = initializeApp({
  apiKey: cfg.apiKey ?? 'missing',
  authDomain: cfg.authDomain ?? 'missing.firebaseapp.com',
  projectId: cfg.projectId ?? 'missing',
  appId: cfg.appId ?? 'missing',
})

// Firebase App Check (optional, free): proves requests come from this real website, so scripts cannot drain the Firestore quota by calling it
// directly. Inactive until you set VITE_APPCHECK_SITE_KEY (a reCAPTCHA v3 site key). Turn on ENFORCEMENT in the Firebase console only after
// the "Metrics" page shows your own traffic as verified (see docs/QUOTA-AND-SPEED.md). It is invisible to visitors.
const appCheckKey = import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined
if (appCheckKey && import.meta.env.VITE_USE_EMULATORS !== 'true') {
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheckKey), isTokenAutoRefreshEnabled: true })
}

export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()

// E2E only: `VITE_USE_EMULATORS=true` points the app at the local Firebase emulators so tests never touch real data.
// The variable is absent in normal builds, so this branch is removed from the production bundle.
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
