import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsProvider } from './contexts/SettingsContext'
import { ToastProvider } from './contexts/ToastContext'
import './index.css'
import { syncThemeColor } from './lib/theme'
import { ErrorBoundary, reloadOnce } from './components/ErrorBoundary'

window.addEventListener('vite:preloadError', (e) => { if (reloadOnce()) e.preventDefault() }) // a stale tab after a deploy: reload once to get the new files
syncThemeColor() // the inline script in index.html already set the dark class; make the phone's browser bar match it too

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <SettingsProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
