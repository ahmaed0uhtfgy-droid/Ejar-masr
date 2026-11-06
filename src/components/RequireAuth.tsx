import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ar } from '../i18n/ar'
import { Empty, Spinner } from './ui'

export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading, isAdmin } = useAuth()
  const loc = useLocation()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />
  if (admin && !isAdmin) return <div className="mx-auto max-w-2xl p-8"><Empty title={ar.admin.denied} /></div>
  return <>{children}</>
}
