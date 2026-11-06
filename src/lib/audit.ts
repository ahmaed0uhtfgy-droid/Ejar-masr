import { addDoc, collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { auth, db } from './firebase'

export async function logAudit(action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}): Promise<void> {
  const u = auth.currentUser
  if (!u) return
  await addDoc(collection(db, 'auditLogs'), { adminId: u.uid, adminEmail: u.email ?? '', action, targetType, targetId, details, createdAt: serverTimestamp() })
}

export async function notifyUser(uid: string, title: string, body: string, unitId: string | null = null): Promise<void> {
  await addDoc(collection(db, 'users', uid, 'notifications'), { type: 'duration', title, body, unitId, read: false, createdAt: serverTimestamp() })
}

export { doc, writeBatch }
