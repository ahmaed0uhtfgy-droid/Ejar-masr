import { Timestamp, addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { paramsToFilters, searchUnits } from './units'

const CHECK_EVERY_MS = 6 * 3600 * 1000

/**
 * In-site notifications for saved searches. Runs at most once per session and only for searches
 * not checked in the last 6 hours. Cost: <= 5 searches x one page (<= 24 reads each).
 */
export async function checkSavedSearches(uid: string): Promise<void> {
  const key = `ejar:ss-check:${uid}`
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* ignore */ }
  const snap = await getDocs(collection(db, 'users', uid, 'savedSearches'))
  for (const d of snap.docs) {
    const data = d.data()
    const last = data.lastCheckedAt instanceof Timestamp ? data.lastCheckedAt.toDate() : new Date(0)
    if (Date.now() - last.getTime() < CHECK_EVERY_MS) continue
    const { filters, sort } = paramsToFilters(new URLSearchParams(String(data.query ?? '')))
    const page = await searchUnits(filters, sort === 'newest' ? 'newest' : 'newest', null, 12)
    const fresh = page.items.filter((u) => u.createdAt && u.createdAt > last && u.ownerId !== uid)
    if (fresh.length) {
      await addDoc(collection(db, 'users', uid, 'notifications'), {
        type: 'saved-search', title: 'وحدات جديدة مطابقة لبحثك', body: `${fresh.length} وحدة جديدة: ${fresh[0].title}`,
        unitId: fresh[0].id, read: false, createdAt: serverTimestamp(),
      })
    }
    await updateDoc(doc(db, 'users', uid, 'savedSearches', d.id), { lastCheckedAt: serverTimestamp() })
  }
}
