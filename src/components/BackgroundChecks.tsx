import { useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { checkSavedSearches } from '../lib/savedSearchCheck'

export function BackgroundChecks() {
  const { user, profile, banned } = useAuth()
  useEffect(() => {
    if (user && profile && !banned) checkSavedSearches(user.uid).catch(() => undefined)
  }, [user, profile, banned])
  return null
}
