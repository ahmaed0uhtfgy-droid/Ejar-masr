import type { Doc, Write } from './firestore'
import { addDaysYmd } from './rent'
import type { PaySettings } from './rentdb'
import { notifyWrite } from './rentdb'

const UNPAID = ['due', 'failed', 'pending']

/**
 * Writes that close a lease (ended or cancelled): cancels unpaid installments, re-lists the unit (only if this lease is what locked it)
 * and starts the deposit claim window. Payments already made stay as they are (held money is settled by the admin).
 */
export function closeLeaseWrites(leaseId: string, L: Record<string, unknown>, status: 'ended' | 'cancelled', pays: Doc[], unit: Doc | null, today: string, s: PaySettings, notifyUid?: { uid: string; title: string; body: string }): Write[] {
  const now = new Date()
  const unitId = String(L.unitId)
  const lease: Record<string, unknown> = { status, updatedAt: now }
  if (status === 'ended') lease.endedAt = now
  if (L.depositStatus === 'held') lease.depositClaimUntil = addDaysYmd(today, L.depositMode === 'held-claim' ? s.depositClaimDays : 0)
  else if (L.depositStatus === 'unpaid') lease.depositStatus = 'none'
  const w: Write[] = [{ kind: 'upsert', path: `leases/${leaseId}`, data: lease }]
  for (const p of pays) if (UNPAID.includes(String(p.data.status))) w.push({ kind: 'upsert', path: `payments/${p.id}`, data: { status: 'cancelled' } })
  if (unit && unit.data.rentedLeaseId === leaseId && unit.data.status === 'rented' && !unit.data.hiddenByAdmin) {
    w.push({ kind: 'upsert', path: `units/${unitId}`, data: { status: 'active', lockedUntil: null, rentedUntil: null, rentedLeaseId: null } })
  }
  if (notifyUid) w.push(notifyWrite(notifyUid.uid, `lease_${leaseId}_${status}`, notifyUid.title, notifyUid.body, unitId))
  return w
}
