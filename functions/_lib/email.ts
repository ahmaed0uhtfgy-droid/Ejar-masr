import type { Env } from './env'
import { escapeHtml } from './logic'

/** Sends a transactional email through Resend. Never throws: email is best-effort, the in-app notification is the source of truth. */
export async function sendEmail(env: Env, to: string, subject: string, body: string, link?: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return false
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><h2>${escapeHtml(subject)}</h2><p>${escapeHtml(body)}</p>${link ? `<p><a href="${escapeHtml(link)}">افتح الموقع</a></p>` : ''}</div>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
    })
    if (!res.ok) console.error('email failed', res.status, await res.text().catch(() => ''))
    return res.ok
  } catch (e) { console.error('email error', e); return false }
}
