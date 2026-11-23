import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '../contexts/SettingsContext'
import { useToast } from '../contexts/ToastContext'
import { apiPost } from '../lib/api'
import { compressToWebP, images as imageApi } from '../lib/images'
import { usePageMeta } from '../lib/seo'
import { Badge, Empty, ErrorBox, Field, Spinner } from '../components/ui'

// ---------- types (mirror functions/api/articles-admin.ts; kept local so the browser bundle never imports server code) ----------
type Status = 'draft' | 'scheduled' | 'published'
interface Entry { slug: string; title: string; status: Status; source: 'ai' | 'manual'; topic: string; govId: string; typeId: string; primary: string; publishAt: number | null; publishedAt: number | null; updatedAt: number; score: number; words: number }
interface Img { id: string; alt: string; href?: string }
interface Faq { q: string; a: string }
interface Article {
  slug: string; title: string; description: string; body: string; primary: string; secondary: string[]; faq: Faq[]; cover: Img | null; images: Img[]
  videoId: string | null; videoTitle: string; status: Status; source: 'ai' | 'manual'; topic: string; govId: string; typeId: string; publishAt: string | null; score: number; issues: string[]
}
interface Form { title: string; slug: string; description: string; primary: string; secondary: string; govId: string; typeId: string; body: string; videoUrl: string; videoTitle: string; cover: Img | null; images: Img[]; faq: Faq[]; topic: string }
interface PlanItem { title: string; primary: string; secondary: string[]; angle: string; audience: string }
interface Topic { topic: string; govId: string; typeId: string }
interface AutoSettings { enabled: boolean; mode: 'review' | 'auto'; everyHours: number; dailyMax: number; minScore: number; topics: Topic[]; cursor: number; loop: boolean; lastRunAt: number | null; lastResult: string; lastError: string; todayCount: number }
interface SaveResult { slug: string; score: number; issues: string[]; similarTo: { slug: string; score: number } | null }

const adm = <T,>(action: string, extra: Record<string, unknown> = {}) => apiPost<T>('/api/articles-admin', { action, ...extra })
const gen = <T,>(body: Record<string, unknown>) => apiPost<T>('/api/articles-generate', body)
const STATUS_LABEL: Record<Status, string> = { draft: 'مسودة', scheduled: 'مجدول', published: 'منشور' }
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const errText = (e: unknown) => (e instanceof Error ? e.message : 'حصل خطأ، حاول تاني')
const EMPTY: Form = { title: '', slug: '', description: '', primary: '', secondary: '', govId: '', typeId: '', body: '', videoUrl: '', videoTitle: '', cover: null, images: [], faq: [], topic: '' }

type Tab = 'list' | 'generate' | 'editor' | 'auto'
const TABS: [Tab, string][] = [['list', 'المقالات'], ['generate', 'توليد بالذكاء الاصطناعي'], ['editor', 'محرر / مقال جديد'], ['auto', 'الأتمتة']]

export default function AdminArticles() {
  usePageMeta({ title: 'إدارة المقالات', noindex: true })
  const [tab, setTab] = useState<Tab>('list')
  const [editing, setEditing] = useState<string | null>(null) // slug being edited; null = a new article
  const open = (slug: string | null) => { setEditing(slug); setTab('editor') }
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl">إدارة المقالات</h1>
      <p className="mt-1 text-mute">الذكاء الاصطناعي بيكتب مسودات، وإنت بتراجع وتنشر. أو شغّل الأتمتة وهو ينشر لوحده لو الجودة عدّت الحد.</p>
      <div role="tablist" className="mt-5 flex flex-wrap gap-2">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => (k === 'editor' ? open(null) : setTab(k))} className={`btn ${tab === k ? 'bg-nile-dark text-white dark:text-paper' : 'border border-line bg-surface'}`}>{l}</button>)}
      </div>
      <div className="mt-6">
        {tab === 'list' && <ListTab onOpen={open} />}
        {tab === 'generate' && <GenerateTab onOpen={open} />}
        {tab === 'editor' && <EditorTab key={editing ?? 'new'} slug={editing} onDone={() => setTab('list')} onSaved={(s) => setEditing(s)} />}
        {tab === 'auto' && <AutoTab />}
      </div>
      <AiCheck />
    </div>
  )
}


// ---------- AI connection check ----------
function AiCheck() {
  const [r, setR] = useState<{ provider: string; model: string; ok: boolean; ms: number; error: string; models: string[] } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true); setR(null); setMsg('')
    try { setR(await adm<NonNullable<typeof r>>('ai-check')) } catch (e) { setMsg(errText(e)) } finally { setBusy(false) }
  }
  return (
    <details className="panel mt-8 p-4">
      <summary className="cursor-pointer font-display">اختبار الاتصال بالذكاء الاصطناعي (لو التوليد بيفشل)</summary>
      <div className="mt-3 space-y-3 text-sm">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void run()}>{busy ? 'بيختبر (لحد 25 ثانية)…' : 'اختبر الآن'}</button>
        {msg && <p className="text-danger" role="alert">{msg}</p>}
        {r && (
          <div className="space-y-2" aria-live="polite">
            <p>المزوّد: <b dir="ltr">{r.provider}</b> · الموديل الحالي: <b dir="ltr">{r.model}</b></p>
            <p className={r.ok ? 'text-nile' : 'text-danger'}>{r.ok ? `اشتغل. زمن الرد ${(r.ms / 1000).toFixed(1)} ثانية` : `فشل بعد ${(r.ms / 1000).toFixed(1)} ثانية: ${r.error}`}</p>
            {r.models.length > 0 && (
              <div>
                <p>الموديلات المتاحة لمفتاحك. اختار واحد وحطه في Cloudflare كمتغير <b dir="ltr">AI_MODEL</b> ثم Redeploy:</p>
                <p dir="ltr" className="mt-1 max-h-48 overflow-y-auto rounded-field border border-line p-2 text-start font-mono text-xs leading-6">{r.models.join('\n')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  )
}

// ---------- list ----------
function ListTab({ onOpen }: { onOpen: (slug: string | null) => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [filter, setFilter] = useState<Status | 'all'>('all')
  const load = useCallback(() => { setErr(null); adm<{ entries: Entry[] }>('list').then((r) => setRows(r.entries.sort((a, b) => b.updatedAt - a.updatedAt))).catch(setErr) }, [])
  useEffect(load, [load])
  async function act(action: 'publish' | 'unpublish' | 'delete', slug: string) {
    if (action === 'delete' && !window.confirm('تحذف المقال نهائيًا؟')) return
    try { await adm(action, { slug }); toast.ok('تمت العملية'); load() } catch (e) { toast.err(errText(e)) }
  }
  if (err) return <ErrorBox error={err} onRetry={load} />
  if (!rows) return <Spinner />
  const shown = rows.filter((r) => filter === 'all' || r.status === filter)
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'draft', 'scheduled', 'published'] as const).map((s) => <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)} className={`btn ${filter === s ? 'bg-nile-dark text-white dark:text-paper' : 'border border-line bg-surface'}`}>{s === 'all' ? `الكل (${rows.length})` : `${STATUS_LABEL[s]} (${count(s)})`}</button>)}
        <button type="button" className="btn-primary ms-auto" onClick={() => onOpen(null)}>مقال جديد</button>
      </div>
      {!shown.length ? <div className="mt-4"><Empty title="مفيش مقالات هنا" hint="اكتب مقال بنفسك أو خلي الذكاء الاصطناعي يولّد مسودات." /></div> : (
        <ul className="mt-4 space-y-3">
          {shown.map((r) => (
            <li key={r.slug} className="panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.status === 'published' ? 'nile' : r.status === 'scheduled' ? 'sand' : 'plain'}>{STATUS_LABEL[r.status]}</Badge>
                <Badge>{r.source === 'ai' ? 'AI' : 'يدوي'}</Badge>
                <Badge tone={r.score >= 80 ? 'nile' : 'sand'}>جودة {r.score}</Badge>
                <span className="text-xs text-mute">{r.words} كلمة · {r.status === 'scheduled' ? `ينشر ${when(r.publishAt)}` : `آخر تعديل ${when(r.updatedAt)}`}</span>
              </div>
              <h2 className="mt-2 font-display text-lg">{r.title}</h2>
              <p dir="ltr" className="text-start text-xs text-mute">/blog/{r.slug}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <button type="button" className="btn-ghost" onClick={() => onOpen(r.slug)}>تعديل ومعاينة</button>
                {r.status === 'published'
                  ? <><a className="btn-ghost" href={`/blog/${encodeURIComponent(r.slug)}`} target="_blank" rel="noreferrer">فتح</a><button type="button" className="btn-ghost" onClick={() => void act('unpublish', r.slug)}>إلغاء النشر</button></>
                  : <button type="button" className="btn-primary" onClick={() => void act('publish', r.slug)}>نشر الآن</button>}
                <button type="button" className="btn-ghost ms-auto text-danger" onClick={() => void act('delete', r.slug)}>حذف</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- shared pickers ----------
function GovTypePick({ govId, typeId, onGov, onType }: { govId: string; typeId: string; onGov: (v: string) => void; onType: (v: string) => void }) {
  const { settings, locations } = useSettings()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="المحافظة (اختياري)"><select className="field" value={govId} onChange={(e) => onGov(e.target.value)}><option value="">عام لكل مصر</option>{locations.govs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="نوع الوحدة (اختياري)"><select className="field" value={typeId} onChange={(e) => onType(e.target.value)}><option value="">كل الأنواع</option>{settings.unitTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
    </div>
  )
}

// ---------- generate ----------
type Row = PlanItem & { on: boolean; state: 'wait' | 'run' | 'done' | 'fail'; slug?: string; score?: number; msg?: string; issues?: string[] }
function GenerateTab({ onOpen }: { onOpen: (slug: string | null) => void }) {
  const toast = useToast()
  const [topic, setTopic] = useState('')
  const [govId, setGovId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [count, setCount] = useState(3)
  const [mode, setMode] = useState<'angles' | 'tweaks'>('angles')
  const [sugg, setSugg] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<'' | 'suggest' | 'plan' | 'write'>('')
  const stop = useRef(false)

  async function suggest() {
    setBusy('suggest')
    try { setSugg((await gen<{ suggestions: string[] }>({ action: 'suggest', seed: topic })).suggestions) } catch (e) { toast.err(errText(e)) } finally { setBusy('') }
  }
  async function plan() {
    setBusy('plan')
    try {
      const r = await gen<{ items: PlanItem[]; suggestions: string[] }>({ action: 'plan', topic, count, mode, govId, typeId })
      setRows(r.items.map((i) => ({ ...i, on: true, state: 'wait' })))
      if (r.suggestions.length) setSugg(r.suggestions)
    } catch (e) { toast.err(errText(e)) } finally { setBusy('') }
  }
  async function write() {
    stop.current = false
    setBusy('write')
    const patch = (i: number, p: Partial<Row>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...p } : r)))
    for (let i = 0; i < rows.length; i++) {
      const it = rows[i]
      if (!it.on || it.state === 'done') continue
      if (stop.current) break
      patch(i, { state: 'run', msg: '' })
      try {
        const r = await gen<{ slug: string; score: number; issues: string[] }>({ action: 'write', topic, govId, typeId, item: { title: it.title, primary: it.primary, secondary: it.secondary, angle: it.angle, audience: it.audience } })
        patch(i, { state: 'done', slug: r.slug, score: r.score, issues: r.issues })
      } catch (e) { patch(i, { state: 'fail', msg: errText(e) }) }
    }
    setBusy('')
  }
  const chosen = rows.filter((r) => r.on && r.state !== 'done').length

  return (
    <div className="space-y-5">
      <div className="panel space-y-4 p-5">
        <Field label="الموضوع أو العنوان" hint="مثال: شقق للايجار في مدينة نصر. يفضل عبارة بحث حقيقية.">
          <div className="flex gap-2">
            <input className="field" value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} />
            <button type="button" className="btn-ghost shrink-0" disabled={topic.trim().length < 3 || !!busy} onClick={() => void suggest()}>{busy === 'suggest' ? '…' : 'اقتراحات جوجل'}</button>
          </div>
        </Field>
        {sugg.length > 0 && <div className="flex flex-wrap gap-2" aria-label="اقتراحات بحث حقيقية">{sugg.map((s) => <button key={s} type="button" className="chip hover:border-nile" onClick={() => setTopic(s)}>{s}</button>)}</div>}
        <GovTypePick govId={govId} typeId={typeId} onGov={setGovId} onType={setTypeId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="عدد المقالات للموضوع ده"><select className="field" value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label="طريقة التنويع">
            <select className="field" value={mode} onChange={(e) => setMode(e.target.value as 'angles' | 'tweaks')}>
              <option value="angles">زوايا مختلفة تمامًا</option>
              <option value="tweaks">تغيير بسيط في العنوان (زاوية وجمهور مختلفين)</option>
            </select>
          </Field>
        </div>
        <button type="button" className="btn-primary" disabled={topic.trim().length < 3 || !!busy} onClick={() => void plan()}>{busy === 'plan' ? 'بخطط العناوين…' : '1) خطّط العناوين'}</button>
      </div>

      {rows.length > 0 && (
        <div className="panel space-y-3 p-5">
          <h2 className="font-display text-lg">راجع العناوين قبل الكتابة</h2>
          <p className="text-sm text-mute">عدّل العنوان أو الكلمة المفتاحية، أو شيل علامة اللي مش عايزه. كل مقال بياخد من نص دقيقة لدقيقة تقريبًا.</p>
          <ul className="space-y-3">
            {rows.map((r, i) => (
              <li key={i} className="rounded-field border border-line p-3">
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-3" aria-label="اكتب المقال ده" checked={r.on} disabled={busy === 'write' || r.state === 'done'} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                  <div className="grid flex-1 gap-2">
                    <input className="field" aria-label="العنوان" value={r.title} disabled={busy === 'write' || r.state === 'done'} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                    <input className="field" aria-label="الكلمة المفتاحية الأساسية" value={r.primary} disabled={busy === 'write' || r.state === 'done'} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, primary: e.target.value } : x)))} />
                    <p className="text-xs text-mute">الزاوية: {r.angle} · الجمهور: {r.audience}</p>
                    {r.state === 'run' && <p className="text-sm text-nile" role="status">بيكتب المقال…</p>}
                    {r.state === 'fail' && <p className="text-sm text-danger" role="alert">{r.msg}</p>}
                    {r.state === 'done' && r.slug && <p className="text-sm">اتحفظ كمسودة (جودة {r.score}). <button type="button" className="text-nile underline" onClick={() => onOpen(r.slug ?? null)}>افتحه للمراجعة</button></p>}
                    {r.state === 'done' && !!r.issues?.length && <ul className="list-disc space-y-0.5 ps-5 text-xs text-mute" aria-label="ملاحظات الجودة">{r.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={!chosen || busy === 'write'} onClick={() => void write()}>{busy === 'write' ? 'بيكتب…' : `2) اكتب ${chosen} مقال`}</button>
            {busy === 'write' && <button type="button" className="btn-ghost" onClick={() => { stop.current = true }}>إيقاف بعد المقال الحالي</button>}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- editor ----------
const toForm = (a: Article): Form => ({ title: a.title, slug: a.slug, description: a.description, primary: a.primary, secondary: a.secondary.join('، '), govId: a.govId, typeId: a.typeId, body: a.body, videoUrl: a.videoId ? `https://youtu.be/${a.videoId}` : '', videoTitle: a.videoTitle, cover: a.cover, images: a.images, faq: a.faq, topic: a.topic })

function EditorTab({ slug, onDone, onSaved }: { slug: string | null; onDone: () => void; onSaved: (slug: string) => void }) {
  const toast = useToast()
  const [f, setF] = useState<Form>(EMPTY)
  const [loaded, setLoaded] = useState(slug === null)
  const [err, setErr] = useState<unknown>(null)
  const [cur, setCur] = useState<{ slug: string; status: Status; publishAt: string | null } | null>(null)
  const [result, setResult] = useState<{ score: number; issues: string[] } | null>(null)
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState('')
  const [when_, setWhen] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!slug) return
    adm<{ article: Article }>('get', { slug }).then(({ article }) => { setF(toForm(article)); setCur({ slug: article.slug, status: article.status, publishAt: article.publishAt }); setResult({ score: article.score, issues: article.issues }); setLoaded(true) }).catch(setErr)
  }, [slug])

  /** Inserts text at the caret (or wraps the selection) in the body box. */
  function put(before: string, after = '', fallback = '') {
    const el = area.current
    if (!el) return
    const a = el.selectionStart, b = el.selectionEnd
    const sel = f.body.slice(a, b) || fallback
    const next = f.body.slice(0, a) + before + sel + after + f.body.slice(b)
    set('body', next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + before.length, a + before.length + sel.length) })
  }
  const block = (t: string) => put(`\n\n${t}\n\n`)

  async function upload(files: FileList | null, kind: 'cover' | 'body') {
    if (!files?.length) return
    setBusy('upload')
    try {
      for (const file of Array.from(files)) {
        const id = await imageApi.upload(await compressToWebP(file))
        if (kind === 'cover') setF((p) => ({ ...p, cover: { id, alt: p.cover?.alt || p.primary || p.title } }))
        else setF((p) => (p.images.length >= 12 ? p : { ...p, images: [...p.images, { id, alt: '' }] }))
      }
    } catch (e) { toast.err(errText(e)) } finally { setBusy('') }
  }

  async function save(): Promise<string | null> {
    try {
      const r = await adm<SaveResult>('save', {
        prevSlug: cur?.slug ?? '', title: f.title, slug: f.slug, description: f.description, primary: f.primary, topic: f.topic,
        secondary: f.secondary.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean), govId: f.govId, typeId: f.typeId, body: f.body,
        video: f.videoUrl, videoTitle: f.videoTitle, cover: f.cover, images: f.images, faq: f.faq.filter((x) => x.q.trim() && x.a.trim()),
      })
      setResult({ score: r.score, issues: r.issues })
      setF((p) => ({ ...p, slug: r.slug }))
      setCur((c) => ({ slug: r.slug, status: c?.status ?? 'draft', publishAt: c?.publishAt ?? null }))
      onSaved(r.slug)
      return r.slug
    } catch (e) { toast.err(errText(e)); return null }
  }
  async function run(label: string, fn: () => Promise<void>) { setBusy(label); try { await fn() } finally { setBusy('') } }
  const saveOnly = () => run('save', async () => { if (await save()) toast.ok('اتحفظ') })
  const publish = () => run('publish', async () => {
    const s = await save(); if (!s) return
    try { await adm('publish', { slug: s }); setCur({ slug: s, status: 'published', publishAt: null }); toast.ok('اتنشر. هيظهر في الموقع خلال دقايق') } catch (e) { toast.err(errText(e)) }
  })
  const schedule = () => run('schedule', async () => {
    if (!when_) { toast.err('اختار تاريخ ووقت'); return }
    const s = await save(); if (!s) return
    try { await adm('schedule', { slug: s, publishAt: new Date(when_).toISOString() }); setCur({ slug: s, status: 'scheduled', publishAt: new Date(when_).toISOString() }); toast.ok('اتجدول') } catch (e) { toast.err(errText(e)) }
  })
  const unpublish = () => run('unpublish', async () => { if (!cur) return; try { await adm('unpublish', { slug: cur.slug }); setCur({ ...cur, status: 'draft', publishAt: null }); toast.ok('رجع مسودة') } catch (e) { toast.err(errText(e)) } })
  const showPreview = () => run('preview', async () => { const s = await save(); if (!s) return; try { setPreview((await adm<{ html: string }>('preview', { slug: s })).html) } catch (e) { toast.err(errText(e)) } })
  const remove = () => run('delete', async () => { if (!cur || !window.confirm('تحذف المقال نهائيًا؟')) return; try { await adm('delete', { slug: cur.slug }); toast.ok('اتحذف'); onDone() } catch (e) { toast.err(errText(e)) } })

  if (err) return <ErrorBox error={err} />
  if (!loaded) return <Spinner />
  const off = !!busy
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl">{cur ? 'تعديل مقال' : 'مقال جديد'}</h2>
          {cur && <Badge tone={cur.status === 'published' ? 'nile' : 'plain'}>{STATUS_LABEL[cur.status]}</Badge>}
        </div>
        <Field label="العنوان" hint={`${f.title.length} حرف. الأفضل بين 40 و65، وفيه الكلمة المفتاحية.`}><input className="field" value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الكلمة المفتاحية الأساسية" hint="عبارة البحث اللي المقال بيستهدفها (2 إلى 5 كلمات)."><input className="field" value={f.primary} maxLength={60} onChange={(e) => set('primary', e.target.value)} /></Field>
          <Field label="كلمات مرتبطة" hint="افصل بينهم بفاصلة."><input className="field" value={f.secondary} onChange={(e) => set('secondary', e.target.value)} /></Field>
        </div>
        <Field label="رابط المقال (اختياري)" hint="سيبه فاضي وهيتولد من الكلمة المفتاحية بكلمات عربية مقروءة."><input dir="ltr" className="field text-start" value={f.slug} maxLength={90} onChange={(e) => set('slug', e.target.value)} placeholder="شقق-للايجار-في-مدينة-نصر" /></Field>
        <Field label="وصف البحث (meta description)" hint={`${f.description.length} حرف. الأفضل بين 110 و165. ده اللي بيظهر تحت العنوان في جوجل.`}><textarea className="field" rows={2} maxLength={220} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <GovTypePick govId={f.govId} typeId={f.typeId} onGov={(v) => set('govId', v)} onType={(v) => set('typeId', v)} />

        <fieldset className="panel space-y-3 p-4">
          <legend className="px-1 font-display">نص المقال</legend>
          <div className="flex flex-wrap gap-2 text-sm">
            <button type="button" className="btn-ghost" onClick={() => put('\n\n## ', '\n\n', 'عنوان رئيسي')}>عنوان H2</button>
            <button type="button" className="btn-ghost" onClick={() => put('\n\n### ', '\n\n', 'عنوان فرعي')}>عنوان H3</button>
            <button type="button" className="btn-ghost" onClick={() => put('**', '**', 'نص عريض')}>عريض</button>
            <button type="button" className="btn-ghost" onClick={() => put('\n- ', '', 'عنصر')}>نقطة</button>
            <button type="button" className="btn-ghost" onClick={() => put('[', '](/search)', 'نص الرابط')}>رابط داخلي</button>
            <button type="button" className="btn-ghost" disabled={!f.videoUrl} onClick={() => block('{{video}}')}>مكان الفيديو</button>
          </div>
          <textarea ref={area} className="field min-h-96 font-mono text-sm leading-7" dir="rtl" value={f.body} maxLength={40000} onChange={(e) => set('body', e.target.value)} aria-label="نص المقال" />
          <p className="text-xs text-mute">اكتب فقرات عادية، والعناوين بـ ## و###. لإدراج صورة اضغط «إدراج» جنب الصورة تحت. أي كود HTML بيتحول لنص عادي (أمان).</p>
        </fieldset>

        <fieldset className="panel space-y-3 p-4">
          <legend className="px-1 font-display">الصور</legend>
          <div>
            <p className="label">صورة الغلاف (بتظهر عند المشاركة على السوشيال)</p>
            {f.cover ? (
              <div className="flex items-start gap-3">
                <img src={imageApi.url(f.cover.id, { w: 160, h: 107 })} alt={f.cover.alt} width={160} height={107} className="rounded-field" />
                <div className="flex-1 space-y-2">
                  <input className="field" aria-label="وصف صورة الغلاف (alt)" placeholder="وصف الصورة" value={f.cover.alt} onChange={(e) => set('cover', { ...(f.cover as Img), alt: e.target.value })} />
                  <button type="button" className="text-sm text-danger underline" onClick={() => set('cover', null)}>شيل الغلاف</button>
                </div>
              </div>
            ) : <label className="btn-ghost cursor-pointer">{busy === 'upload' ? 'بيرفع…' : 'ارفع صورة غلاف'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void upload(e.target.files, 'cover'); e.target.value = '' }} /></label>}
          </div>
          <div>
            <p className="label">صور داخل المقال ({f.images.length}/12)</p>
            <ul className="space-y-3">
              {f.images.map((im, i) => (
                <li key={im.id} className="flex items-start gap-3">
                  <img src={imageApi.url(im.id, { w: 120, h: 80 })} alt={im.alt} width={120} height={80} className="rounded-field" />
                  <div className="flex-1 space-y-2">
                    <input className="field" aria-label={`وصف الصورة ${i + 1} (alt)`} placeholder="وصف الصورة (مهم للسيو ولقارئات الشاشة)" value={im.alt} onChange={(e) => set('images', f.images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} />
                    <div className="flex gap-3 text-sm">
                      <button type="button" className="text-nile underline" onClick={() => block(`{{image:${i + 1}}}`)}>إدراج في المقال (صورة {i + 1})</button>
                      <button type="button" className="text-danger underline" onClick={() => { set('images', f.images.filter((_, j) => j !== i)); toast.ok('الصور اتعاد ترقيمها. راجع أماكن {{image:رقم}} في النص') }}>حذف</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {f.images.length < 12 && <label className="btn-ghost mt-3 cursor-pointer">{busy === 'upload' ? 'بيرفع…' : 'ارفع صور'}<input type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void upload(e.target.files, 'body'); e.target.value = '' }} /></label>}
          </div>
        </fieldset>

        <fieldset className="panel space-y-3 p-4">
          <legend className="px-1 font-display">فيديو يوتيوب (اختياري)</legend>
          <Field label="رابط الفيديو"><input dir="ltr" className="field text-start" placeholder="https://www.youtube.com/watch?v=..." value={f.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} /></Field>
          <Field label="عنوان الفيديو" hint="لو سيبته فاضي هيتحط عنوان المقال. لو ما حطيتش {{video}} في النص هيتحط قبل آخر قسم."><input className="field" value={f.videoTitle} onChange={(e) => set('videoTitle', e.target.value)} /></Field>
        </fieldset>

        <fieldset className="panel space-y-3 p-4">
          <legend className="px-1 font-display">أسئلة شائعة (بتظهر في جوجل كأسئلة وأجوبة)</legend>
          {f.faq.map((x, i) => (
            <div key={i} className="space-y-2 rounded-field border border-line p-3">
              <input className="field" aria-label="السؤال" placeholder="السؤال" value={x.q} onChange={(e) => set('faq', f.faq.map((y, j) => (j === i ? { ...y, q: e.target.value } : y)))} />
              <textarea className="field" rows={2} aria-label="الإجابة" placeholder="الإجابة" value={x.a} onChange={(e) => set('faq', f.faq.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)))} />
              <button type="button" className="text-sm text-danger underline" onClick={() => set('faq', f.faq.filter((_, j) => j !== i))}>حذف السؤال</button>
            </div>
          ))}
          {f.faq.length < 10 && <button type="button" className="btn-ghost" onClick={() => set('faq', [...f.faq, { q: '', a: '' }])}>إضافة سؤال</button>}
        </fieldset>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="panel space-y-3 p-4">
          <button type="button" className="btn-ghost w-full" disabled={off} onClick={() => void saveOnly()}>{busy === 'save' ? '…' : 'حفظ'}</button>
          <button type="button" className="btn-ghost w-full" disabled={off} onClick={() => void showPreview()}>{busy === 'preview' ? '…' : 'حفظ ومعاينة'}</button>
          <button type="button" className="btn-primary w-full" disabled={off} onClick={() => void publish()}>{busy === 'publish' ? '…' : cur?.status === 'published' ? 'حفظ التعديلات (منشور)' : 'نشر الآن'}</button>
          {cur?.status === 'published' && <button type="button" className="btn-ghost w-full" disabled={off} onClick={() => void unpublish()}>إلغاء النشر</button>}
          <div className="border-t border-line pt-3">
            <label className="label" htmlFor="when">جدولة النشر</label>
            <input id="when" type="datetime-local" className="field" value={when_} onChange={(e) => setWhen(e.target.value)} />
            <button type="button" className="btn-ghost mt-2 w-full" disabled={off} onClick={() => void schedule()}>{busy === 'schedule' ? '…' : 'جدولة'}</button>
            {cur?.status === 'scheduled' && <p className="mt-1 text-xs text-mute">مجدول: {when(cur.publishAt ? Date.parse(cur.publishAt) : null)}</p>}
          </div>
          {cur && <button type="button" className="btn-ghost w-full text-danger" disabled={off} onClick={() => void remove()}>حذف المقال</button>}
        </div>
        {result && (
          <div className="panel p-4" aria-live="polite">
            <p className="font-display text-lg">جودة السيو: <span className={result.score >= 80 ? 'text-nile' : 'text-sand'}>{result.score}/100</span></p>
            {result.issues.length ? <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-mute">{result.issues.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="mt-1 text-sm text-mute">مفيش ملاحظات.</p>}
          </div>
        )}
      </aside>

      {preview && (
        <div className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-display text-lg">المعاينة (شكل الزائر)</h2><button type="button" className="btn-ghost" onClick={() => setPreview('')}>إغلاق</button></div>
          {/* sandbox with no flags: no scripts, no navigation out, no storage. The HTML is server-rendered by the same safe renderer visitors get. */}
          <iframe title="معاينة المقال" sandbox="" srcDoc={preview} className="h-[80vh] w-full rounded-panel border border-line bg-white" />
        </div>
      )}
    </div>
  )
}

// ---------- automation ----------
function AutoTab() {
  const toast = useToast()
  const [s, setS] = useState<AutoSettings | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState('')
  const [tick, setTick] = useState('')
  const [bulk, setBulk] = useState('')
  const [bulkGov, setBulkGov] = useState('')
  const [bulkType, setBulkType] = useState('')
  const { settings, locations } = useSettings()
  const load = useCallback(() => adm<{ settings: AutoSettings }>('settings').then((r) => setS(r.settings)).catch(setErr), [])
  useEffect(() => { void load() }, [load])
  if (err) return <ErrorBox error={err} onRetry={() => void load()} />
  if (!s) return <Spinner />
  const up = <K extends keyof AutoSettings>(k: K, v: AutoSettings[K]) => setS({ ...s, [k]: v })
  const addBulk = () => {
    const have = new Set(s.topics.map((x) => x.topic))
    const lines = bulk.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+\s*[.)\-:])\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter((l) => l.length >= 3 && !have.has(l))
    const fresh = Array.from(new Set(lines)).map((topic) => ({ topic, govId: bulkGov, typeId: bulkType }))
    if (!fresh.length) { toast.err('مفيش عناوين جديدة (أو كلها مكررة)'); return }
    const room = 300 - s.topics.length
    up('topics', [...s.topics, ...fresh.slice(0, room)])
    setBulk('')
    toast.ok(fresh.length > room ? `اتضاف ${room} عنوان بس (الحد 300). افتكر تضغط حفظ الإعدادات` : `اتضاف ${Math.min(fresh.length, room)} عنوان. افتكر تضغط حفظ الإعدادات`)
  }
  const setTopic = (i: number, p: Partial<Topic>) => up('topics', s.topics.map((t, j) => (j === i ? { ...t, ...p } : t)))

  async function save() {
    setBusy('save')
    try { setS((await adm<{ settings: AutoSettings }>('settings-save', { settings: s })).settings); toast.ok('اتحفظت الإعدادات') } catch (e) { toast.err(errText(e)) } finally { setBusy('') }
  }
  async function runNow() {
    setBusy('run'); setTick('')
    try {
      const r = await apiPost<{ published: number; generated: string | null; skipped: string | null; error: string | null }>('/api/article-cron', {})
      setTick([r.generated && `اتكتب: ${r.generated}`, r.published && `اتنشر ${r.published} مجدول`, r.skipped && `اتخطى: ${r.skipped}`, r.error && `خطأ: ${r.error}`].filter(Boolean).join(' · ') || 'مفيش حاجة مستحقة دلوقتي')
      await load()
    } catch (e) { toast.err(errText(e)) } finally { setBusy('') }
  }

  return (
    <div className="space-y-5">
      <div className="panel space-y-4 p-5">
        <label className="flex items-center gap-3"><input type="checkbox" checked={s.enabled} onChange={(e) => up('enabled', e.target.checked)} /><span className="font-display text-lg">تشغيل الكتابة التلقائية</span></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="لما المقال يجهز">
            <select className="field" value={s.mode} onChange={(e) => up('mode', e.target.value as 'review' | 'auto')}>
              <option value="review">يتحفظ مسودة وأنا أراجع وأنشر (الأأمن)</option>
              <option value="auto">ينشر لوحده لو الجودة عدّت الحد</option>
            </select>
          </Field>
          <Field label="مقال كل كام ساعة"><input type="number" min={1} max={168} className="field" value={s.everyHours} onChange={(e) => up('everyHours', Number(e.target.value))} /></Field>
          <Field label="الحد الأقصى في اليوم"><input type="number" min={1} max={8} className="field" value={s.dailyMax} onChange={(e) => up('dailyMax', Number(e.target.value))} /></Field>
          <Field label="أقل جودة للنشر التلقائي" hint="لو التقييم أقل، المقال بيتحفظ مسودة. 80 مناسب."><input type="number" min={60} max={95} className="field" value={s.minScore} onChange={(e) => up('minScore', Number(e.target.value))} /></Field>
        </div>
        <p className="text-sm text-mute">«كل 24 ساعة» = مقال يوميًا. الموقع بيمشي على قائمة المواضيع تحت بالترتيب، وبيدور تاني من الأول لما تخلص (بزاوية مختلفة كل لفة).</p>
      </div>

      <fieldset className="panel space-y-3 p-5">
        <legend className="px-1 font-display">قائمة العناوين ({s.topics.length}/300)</legend>
        <p className="text-sm text-mute">الصق عناوينك هنا، كل عنوان في سطر (لحد 300). الموقع بيكتب مقال لكل سطر بالترتيب، ومقال واحد في كل مرة حسب المدة اللي حددتها فوق. كل عنوان بيتحول لمقال بعنوان مقارب له والكلمة المفتاحية جواه.</p>
        <textarea className="field min-h-40" dir="rtl" aria-label="الصق العناوين، كل عنوان في سطر" placeholder={'شقق للايجار في مدينة نصر\nإيجار شقة للعرسان في القاهرة\nأخطاء المستأجر قبل توقيع العقد'} value={bulk} onChange={(e) => setBulk(e.target.value)} />
        <GovTypePick govId={bulkGov} typeId={bulkType} onGov={setBulkGov} onType={setBulkType} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={!bulk.trim()} onClick={addBulk}>إضافة العناوين للقائمة</button>
          {s.topics.length > 0 && <button type="button" className="btn-ghost text-danger" onClick={() => { if (window.confirm('تمسح كل العناوين من القائمة؟')) up('topics', []) }}>مسح القائمة</button>}
        </div>
        <label className="flex items-center gap-3 pt-2"><input type="checkbox" checked={s.loop} onChange={(e) => up('loop', e.target.checked)} /><span>لما العناوين تخلص، ابدأ من الأول بزاوية مختلفة (لو مش مفعّل بيقف بعد آخر عنوان)</span></label>
        <p className="text-sm">اتكتب <b>{Math.min(s.cursor, s.topics.length)}</b> من <b>{s.topics.length}</b> عنوان.</p>
        <ul className="max-h-96 space-y-2 overflow-y-auto">
          {s.topics.map((t, i) => (
            <li key={i} className="grid items-center gap-2 sm:grid-cols-[2rem_1fr_9rem_8rem_auto]">
              <span className="text-xs text-mute" aria-label={i < s.cursor ? 'اتكتب' : 'في الانتظار'}>{i < s.cursor ? '✓' : i + 1}</span>
              <input className="field" aria-label="الموضوع" value={t.topic} maxLength={120} onChange={(e) => setTopic(i, { topic: e.target.value })} />
              <select className="field" aria-label="المحافظة" value={t.govId} onChange={(e) => setTopic(i, { govId: e.target.value })}><option value="">عام</option>{locations.govs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
              <select className="field" aria-label="النوع" value={t.typeId} onChange={(e) => setTopic(i, { typeId: e.target.value })}><option value="">كل الأنواع</option>{settings.unitTypes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
              <button type="button" className="btn-ghost text-danger" onClick={() => up('topics', s.topics.filter((_, j) => j !== i))}>حذف</button>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? '…' : 'حفظ الإعدادات'}</button>
        <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => void runNow()}>{busy === 'run' ? 'بيشتغل…' : 'شغّل الفحص الآن'}</button>
      </div>
      {tick && <p className="text-sm" role="status">{tick}</p>}

      <div className="panel p-5 text-sm">
        <h2 className="font-display text-lg">آخر تشغيل</h2>
        <p className="mt-1">الوقت: {when(s.lastRunAt)} · مقالات النهارده: {s.todayCount}</p>
        {s.lastResult && <p className="mt-1">النتيجة: {s.lastResult}</p>}
        {s.lastError && <p className="mt-1 text-danger" role="alert">آخر خطأ: {s.lastError}</p>}
        <p className="mt-3 text-mute">التشغيل التلقائي بيحتاج: مفتاح AI في Cloudflare، وملف <span dir="ltr">.github/workflows/articles.yml</span> مفعّل (أسرار SITE_URL و CRON_SECRET). التفاصيل في docs/ARTICLES.md.</p>
      </div>
    </div>
  )
}
