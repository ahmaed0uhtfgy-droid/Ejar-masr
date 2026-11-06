import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  GoogleAuthProvider, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signOut as fbSignOut, updateProfile, type User,
} from 'firebase/auth'
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db, googleProvider } from '../lib/firebase'
import type { AccountType, UserDoc } from '../lib/types'

interface AuthState {
  user: User | null
  profile: UserDoc | null
  loading: boolean
  isAdmin: boolean
  banned: boolean
  favorites: Set<string>
  signInEmail(email: string, password: string): Promise<void>
  signUpEmail(email: string, password: string, name: string, accountType: AccountType): Promise<void>
  signInGoogle(): Promise<void>
  resetPassword(email: string): Promise<void>
  signOut(): Promise<void>
  refreshProfile(): Promise<void>
  toggleFavorite(unitId: string): Promise<void>
}

const Ctx = createContext<AuthState | null>(null)
let pending: { name: string; accountType: AccountType } | null = null

function toProfile(uid: string, d: Record<string, unknown>): UserDoc {
  return {
    uid,
    displayName: String(d.displayName ?? ''), email: String(d.email ?? ''),
    role: d.role === 'admin' ? 'admin' : 'user',
    accountType: d.accountType === 'broker' ? 'broker' : 'owner',
    banned: d.banned === true, verified: d.verified === true,
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : null,
  }
}

async function ensureProfile(u: User): Promise<UserDoc> {
  const ref = doc(db, 'users', u.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return toProfile(u.uid, snap.data())
  const data = {
    displayName: (pending?.name || u.displayName || u.email?.split('@')[0] || 'مستخدم').slice(0, 60),
    email: u.email ?? '', role: 'user', accountType: pending?.accountType ?? 'owner',
    banned: false, verified: false, createdAt: serverTimestamp(),
  }
  pending = null
  await setDoc(ref, data)
  return toProfile(u.uid, { ...data, createdAt: Timestamp.now() })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u)
    if (!u) { setProfile(null); setFavorites(new Set()); setLoading(false); return }
    setLoading(true)
    ensureProfile(u)
      .then(async (p) => {
        setProfile(p)
        const fav = await getDocs(collection(db, 'users', u.uid, 'favorites')).catch(() => null)
        setFavorites(new Set(fav?.docs.map((d) => d.id) ?? []))
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false))
  }), [])

  const refreshProfile = useCallback(async () => {
    if (auth.currentUser) setProfile(await ensureProfile(auth.currentUser))
  }, [])

  const toggleFavorite = useCallback(async (unitId: string) => {
    const u = auth.currentUser
    if (!u) return
    const ref = doc(db, 'users', u.uid, 'favorites', unitId)
    const has = favorites.has(unitId)
    setFavorites((prev) => { const n = new Set(prev); if (has) n.delete(unitId); else n.add(unitId); return n })
    try {
      if (has) await deleteDoc(ref)
      else await setDoc(ref, { createdAt: serverTimestamp() })
    } catch (e) {
      setFavorites((prev) => { const n = new Set(prev); if (has) n.add(unitId); else n.delete(unitId); return n })
      throw e
    }
  }, [favorites])

  const value = useMemo<AuthState>(() => ({
    user, profile, loading, favorites,
    isAdmin: profile?.role === 'admin', banned: profile?.banned === true,
    signInEmail: async (e, p) => { await signInWithEmailAndPassword(auth, e, p) },
    signUpEmail: async (e, p, name, accountType) => {
      pending = { name, accountType }
      const cred = await createUserWithEmailAndPassword(auth, e, p)
      await updateProfile(cred.user, { displayName: name })
    },
    signInGoogle: async () => { await signInWithPopup(auth, googleProvider) },
    resetPassword: (e) => sendPasswordResetEmail(auth, e),
    signOut: () => fbSignOut(auth),
    refreshProfile, toggleFavorite,
  }), [user, profile, loading, favorites, refreshProfile, toggleFavorite])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

export { GoogleAuthProvider }
