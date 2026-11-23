import type { Env } from '../_lib/env'
import { accessToken } from '../_lib/google'
import { commit, runQuery } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'

/** POST /api/admin-delete-user { uid } - admin only. Deletes the Auth account, profile and up to 200 of the user's ads. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const admin = await requireUser(request, env, { admin: true })
    const { uid } = await readJson<{ uid?: unknown }>(request)
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw new HttpError(400, 'bad-uid', 'معرّف غير صحيح')
    if (uid === admin.uid) throw new HttpError(400, 'self', 'مينفعش تحذف حسابك')

    // Never delete someone who is part of a live lease or whose deposit is unresolved: money and the other party's records depend on them.
    for (const side of ['ownerId', 'tenantId']) {
      const leases = await runQuery(env, { collection: 'leases', where: [{ field: side, op: 'EQUAL', value: uid }], limit: 200 })
      const blocking = leases.find((l) => ['active', 'requested'].includes(String(l.data.status)) || ['held', 'claimed', 'disputed'].includes(String(l.data.depositStatus)) || (l.data.depositStatus === 'settled' && l.data.depositTransfer === 'pending'))
      if (blocking) throw new HttpError(409, 'has-leases', 'المستخدم عنده عقد شغال أو تأمين لسه متسواش. خلّص العقد الأول (إنهاء/تسوية) وبعدين احذفه.')
    }
    const units = await runQuery(env, { collection: 'units', where: [{ field: 'ownerId', op: 'EQUAL', value: uid }], limit: 200 })
    const writes = units.flatMap((u) => [{ kind: 'delete' as const, path: `contacts/${u.id}` }, { kind: 'delete' as const, path: `units/${u.id}` }])
    for (let i = 0; i < writes.length; i += 200) await commit(env, writes.slice(i, i + 200))

    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:delete`, {
      method: 'POST', headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: uid }),
    })
    // USER_NOT_FOUND is fine (account already gone); anything else should surface.
    if (!res.ok && !(await res.text()).includes('USER_NOT_FOUND')) throw new HttpError(502, 'auth-delete', 'فشل حذف حساب الدخول')
    await commit(env, [
      { kind: 'delete', path: `users/${uid}/payout/main` }, // bank / wallet details must not outlive the account
      { kind: 'delete', path: `users/${uid}` },
      { kind: 'create', path: `auditLogs/del_${uid}_${Date.now()}`, data: { adminId: admin.uid, adminEmail: String(admin.data.email ?? ''), action: 'user.delete', targetType: 'user', targetId: uid, details: { unitsDeleted: units.length }, createdAt: new Date() } },
    ])
    return json({ ok: true, unitsDeleted: units.length })
  } catch (e) { return errorResponse(e) }
}
