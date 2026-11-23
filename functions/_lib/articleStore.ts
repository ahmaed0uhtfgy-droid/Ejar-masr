/** Storage for blog articles. The article body lives in articles/{slug}; ONE small directory document lists every article (for the admin list, the public index, duplicate checks and sibling links). */
import { edgePurge } from './edgeLimit'
import type { Env } from './env'
import { commitGuarded, getDocument, type Write } from './firestore'
import { minhash } from './articleQuality'
import { wordCount, type ArticleImage } from './articleText'

export type ArticleStatus = 'draft' | 'scheduled' | 'published'
export interface ArticleDoc {
  slug: string; title: string; description: string; body: string; primary: string; secondary: string[]
  faq: { q: string; a: string }[]; cover: ArticleImage | null; images: ArticleImage[]; videoId: string | null; videoTitle: string
  status: ArticleStatus; source: 'ai' | 'manual'; topic: string; angle: string; govId: string; typeId: string
  publishAt: Date | null; publishedAt: Date | null; createdAt: Date; updatedAt: Date
  score: number; issues: string[]; similarTo: { slug: string; score: number } | null; ai: { provider: string; model: string } | null
}
export interface DirEntry {
  slug: string; title: string; status: ArticleStatus; source: 'ai' | 'manual'; topic: string; govId: string; typeId: string; primary: string
  publishAt: number | null; publishedAt: number | null; createdAt: number; updatedAt: number; score: number; words: number; sig: number[]; cover: string
  description: string; coverAlt: string
}

export const DIR_PATH = 'articleMeta/directory'
export const MAX_ARTICLES = 600
const ms = (d: unknown): number | null => (d instanceof Date ? d.getTime() : null)
const dt = (d: unknown): Date | null => (d instanceof Date ? d : null)

export function toEntry(a: ArticleDoc): DirEntry {
  return {
    slug: a.slug, title: a.title, status: a.status, source: a.source, topic: a.topic, govId: a.govId, typeId: a.typeId, primary: a.primary,
    publishAt: ms(a.publishAt), publishedAt: ms(a.publishedAt), createdAt: a.createdAt.getTime(), updatedAt: a.updatedAt.getTime(), score: a.score, words: wordCount(a.body),
    sig: minhash(a.body), cover: a.cover?.id ?? a.images[0]?.id ?? '', description: a.description.slice(0, 200), coverAlt: a.cover?.alt ?? a.images[0]?.alt ?? '',
  }
}

export interface Directory { entries: DirEntry[]; updateTime?: string; exists: boolean }
export async function loadDirectory(env: Env): Promise<Directory> {
  const d = await getDocument(env, DIR_PATH)
  if (!d || typeof d.data.json !== 'string') return { entries: [], exists: !!d, updateTime: d?.updateTime }
  try { return { entries: (JSON.parse(d.data.json) as { entries: DirEntry[] }).entries ?? [], exists: true, updateTime: d.updateTime } } catch { return { entries: [], exists: true, updateTime: d.updateTime } }
}

const img = (v: unknown): ArticleImage | null => { const o = v as Record<string, unknown> | null; return o && typeof o.id === 'string' ? { id: o.id, alt: String(o.alt ?? ''), ...(typeof o.href === 'string' && o.href ? { href: o.href } : {}) } : null }
export function fromDoc(slug: string, d: Record<string, unknown>): ArticleDoc {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const sim = d.similarTo as Record<string, unknown> | null
  const ai = d.ai as Record<string, unknown> | null
  return {
    slug, title: String(d.title ?? ''), description: String(d.description ?? ''), body: String(d.body ?? ''), primary: String(d.primary ?? ''), secondary: arr(d.secondary).map(String),
    faq: arr(d.faq).map((f) => ({ q: String((f as Record<string, unknown>).q ?? ''), a: String((f as Record<string, unknown>).a ?? '') })), cover: img(d.cover), images: arr(d.images).flatMap((i) => { const x = img(i); return x ? [x] : [] }),
    videoId: typeof d.videoId === 'string' && d.videoId ? d.videoId : null, videoTitle: String(d.videoTitle ?? ''),
    status: d.status === 'published' || d.status === 'scheduled' ? d.status : 'draft', source: d.source === 'ai' ? 'ai' : 'manual', topic: String(d.topic ?? ''), angle: String(d.angle ?? ''), govId: String(d.govId ?? ''), typeId: String(d.typeId ?? ''),
    publishAt: dt(d.publishAt), publishedAt: dt(d.publishedAt), createdAt: dt(d.createdAt) ?? new Date(0), updatedAt: dt(d.updatedAt) ?? new Date(0),
    score: Number(d.score) || 0, issues: arr(d.issues).map(String), similarTo: sim && typeof sim.slug === 'string' ? { slug: sim.slug, score: Number(sim.score) || 0 } : null, ai: ai && typeof ai.provider === 'string' ? { provider: ai.provider, model: String(ai.model ?? '') } : null,
  }
}
export async function readArticle(env: Env, slug: string): Promise<ArticleDoc | null> {
  const d = await getDocument(env, `articles/${slug}`)
  return d ? fromDoc(slug, d.data) : null
}

function toData(a: ArticleDoc): Record<string, unknown> {
  const { slug: _slug, ...rest } = a // the slug is the document id
  void _slug
  return { ...rest }
}

/**
 * Saves an article AND keeps the directory in step, in one atomic commit guarded against concurrent changes.
 * `create`: fail (ConflictError) if the slug is already taken. `prevSlug`: the article is being renamed (old document removed in the same commit).
 */
export async function saveArticle(env: Env, a: ArticleDoc, o: { create: boolean; prevSlug?: string }): Promise<DirEntry> {
  const dir = await loadDirectory(env)
  const entry = toEntry(a)
  const others = dir.entries.filter((e) => e.slug !== a.slug && e.slug !== o.prevSlug)
  if (others.length >= MAX_ARTICLES) throw new Error(`article limit ${MAX_ARTICLES} reached`)
  const writes: Write[] = [o.create || (o.prevSlug && o.prevSlug !== a.slug) ? { kind: 'create', path: `articles/${a.slug}`, data: toData(a) } : { kind: 'upsert', path: `articles/${a.slug}`, data: toData(a) }]
  if (o.prevSlug && o.prevSlug !== a.slug) writes.push({ kind: 'delete', path: `articles/${o.prevSlug}` })
  const json = JSON.stringify({ entries: [entry, ...others].sort((x, y) => y.createdAt - x.createdAt) })
  writes.push(dir.exists ? { kind: 'upsert', path: DIR_PATH, data: { json, updatedAt: new Date() } } : { kind: 'create', path: DIR_PATH, data: { json, updatedAt: new Date() } })
  await commitGuarded(env, writes, { [DIR_PATH]: dir.updateTime })
  await purgeArticle(a.slug); if (o.prevSlug) await purgeArticle(o.prevSlug)
  return entry
}

export async function deleteArticle(env: Env, slug: string): Promise<boolean> {
  const dir = await loadDirectory(env)
  if (!dir.entries.some((e) => e.slug === slug)) return false
  const json = JSON.stringify({ entries: dir.entries.filter((e) => e.slug !== slug) })
  await commitGuarded(env, [{ kind: 'delete', path: `articles/${slug}` }, { kind: 'upsert', path: DIR_PATH, data: { json, updatedAt: new Date() } }], { [DIR_PATH]: dir.updateTime })
  await purgeArticle(slug)
  return true
}

/** Drops the cached copies (on this data center) of an article page and of the blog index / sitemap data. */
export async function purgeArticle(slug: string): Promise<void> { await Promise.all([edgePurge(`blog:${slug}`), edgePurge('blog-directory')]) }
