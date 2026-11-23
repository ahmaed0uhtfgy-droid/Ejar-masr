// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { arabicSlug, excerpt, isValidSlug, normalizeArabic, plainText, readingMinutes, renderInline, renderMarkdown, uniqueSlug, wordCount, youtubeId } from './articleText'

const ctx = { images: [{ id: 'demo:blog/a', alt: 'شقة في مدينة نصر', href: '/unit/abc123def4' }, { id: 'demo:blog/b', alt: '' }], imageUrl: (id: string, w: number) => `https://res.cloudinary.com/${id.split(':')[0]}/image/upload/w_${w}/${id.split(':')[1]}` }
const XSS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', "'; alert(1); //", '</p><script>x</script>', '<iframe src="javascript:alert(1)">']

describe('arabicSlug', () => {
  it('keeps the Arabic words people search for and normalises them', () => {
    expect(arabicSlug('شقق للإيجار في مدينة نصر')).toBe('شقق-للايجار-في-مدينة-نصر')
    expect(arabicSlug('أفضل ٥ مناطق لـ"الإيجار" في القاهرة!')).toBe('افضل-5-مناطق-ل-الايجار-في-القاهرة')
    expect(arabicSlug('إِيجَارٌ  مَفْرُوشٌ')).toBe('ايجار-مفروش')
    expect(arabicSlug('Rent in Maadi 2027')).toBe('rent-in-maadi-2027')
  })
  it('never produces slashes, dots, spaces or markup, and is a valid slug (or empty)', () => {
    for (const bad of [...XSS, '../../etc/passwd', 'a/b?c=d#e', '   ', '%00', '😀😀']) { const s: string = arabicSlug(bad); const short = s.length < 3; expect(s === '' || short || isValidSlug(s)).toBe(true); expect(s).not.toMatch(/[/\\.?#%<>"' ]/) }
  })
  it('is cut at a word boundary under the limit', () => {
    const s = arabicSlug('كلمة '.repeat(60), 40)
    expect(s.length).toBeLessThanOrEqual(40); expect(s.endsWith('-')).toBe(false)
  })
  it('normalizeArabic unifies alef/ya forms and digits', () => { expect(normalizeArabic('أإآ ى ٠١٢٣ ـــ')).toBe('ااا ي 0123 ') })
})

describe('uniqueSlug', () => {
  it('adds -2, -3 ... until free', async () => {
    const taken = new Set(['مقال-تجريبي', 'مقال-تجريبي-2'])
    expect(await uniqueSlug('مقال-تجريبي', async (s) => taken.has(s))).toBe('مقال-تجريبي-3')
    expect(await uniqueSlug('جديد', async () => false)).toBe('جديد')
    expect(await uniqueSlug('', async () => false)).toBe('مقال')
  })
})

describe('renderInline (links and emphasis)', () => {
  it('formats bold and safe links', () => {
    expect(renderInline('جرّب **البحث** من [هنا](/search)')).toBe('جرّب <strong>البحث</strong> من <a href="/search">هنا</a>')
    expect(renderInline('[موقع](https://example.com/a?b=1&c=2)')).toBe('<a href="https://example.com/a?b=1&amp;c=2" rel="nofollow noopener" target="_blank">موقع</a>')
  })
  it('drops dangerous or off-site-relative URLs but keeps the words', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', '//evil.com', 'vbscript:x', '/\\evil.com', 'ftp://x', '/x"onmouseover="alert(1)']) {
      const out = renderInline(`[اضغط](${url})`)
      expect(out).not.toContain('<a'); expect(out).not.toMatch(/href/i)
    }
  })
  it('escapes all HTML in text and in link labels', () => {
    for (const p of XSS) { for (const out of [renderInline(p), renderInline(`[${p}](/x)`), renderInline(`**${p}**`)]) { expect(out).not.toMatch(/<(script|img|svg|iframe)/i); expect(out.replace(/<\/?(strong|a)[^>]*>/g, '')).not.toMatch(/[<>]/) } }
  })
})

describe('renderMarkdown', () => {
  const md = ['## أول عنوان', 'فقرة أولى فيها **تأكيد**.', '', '### فرع', '- نقطة أ', '- نقطة ب', '', '1. خطوة', '2. خطوة تانية', '', '> اقتباس', '', '{{image:1}}', '{{image:2}}', '{{image:9}}', '---', '## عنوان تاني'].join('\n')
  it('renders headings with ids, paragraphs, lists, quotes, images and rules', () => {
    const { html, headings } = renderMarkdown(md, ctx)
    expect(headings).toEqual([{ id: 'اول-عنوان', text: 'أول عنوان', level: 2 }, { id: 'فرع', text: 'فرع', level: 3 }, { id: 'عنوان-تاني', text: 'عنوان تاني', level: 2 }])
    expect(html).toContain('<h2 id="اول-عنوان">أول عنوان</h2>')
    expect(html).toContain('<ul><li>نقطة أ</li><li>نقطة ب</li></ul>'); expect(html).toContain('<ol><li>خطوة</li>')
    expect(html).toContain('<blockquote>'); expect(html).toContain('<hr>')
  })
  it('images: alt text everywhere, optional link, lazy loading, explicit size (no layout shift); unknown index is ignored', () => {
    const { html } = renderMarkdown(md, ctx)
    expect(html).toContain('<a href="/unit/abc123def4"><img src="https://res.cloudinary.com/demo/image/upload/w_900/blog/a"')
    expect(html).toContain('alt="شقة في مدينة نصر"'); expect(html).toContain('loading="lazy"'); expect(html).toContain('width="900" height="600"')
    expect((html.match(/<figure>/g) ?? []).length).toBe(2)
  })
  it('duplicate headings get unique ids', () => { expect(renderMarkdown('## نفس\n## نفس\n## نفس', ctx).headings.map((h) => h.id)).toEqual(['نفس', 'نفس-2', 'نفس-3']) })
  it('the video marker is replaced by the prepared embed, and ignored when there is none', () => {
    expect(renderMarkdown('{{video}}', { ...ctx, videoHtml: '<div class="video">V</div>' }).html).toBe('<div class="video">V</div>')
    expect(renderMarkdown('{{video}}', ctx).html).toBe('')
  })
  it('hostile content in ANY position never becomes markup', () => {
    for (const p of XSS) {
      const { html } = renderMarkdown([`## ${p}`, p, `- ${p}`, `1. ${p}`, `> ${p}`, `[${p}](/x)`, `![${p}](x)`].join('\n'), ctx)
      const stripped = html.replace(/<\/?(h[23]|p|ul|ol|li|blockquote|strong|a)\b[^>]*>/g, '')
      expect(stripped).not.toMatch(/[<>]/)
    }
  })
  it('image alt text cannot break out of its attribute', () => {
    const { html } = renderMarkdown('{{image:1}}', { ...ctx, images: [{ id: 'demo:x', alt: '" onerror="alert(1)' }] })
    const tag = /<img [^>]*>/.exec(html)?.[0] ?? ''
    expect(tag.replace(/"[^"]*"/g, '""')).not.toMatch(/onerror/) // with the quoted values removed no event-handler attribute is left
    expect(html).toContain('alt="&quot; onerror=&quot;alert(1)"')
  })
  it('an unsafe image link is dropped, the image stays', () => {
    const { html } = renderMarkdown('{{image:1}}', { ...ctx, images: [{ id: 'demo:x', alt: 'a', href: 'javascript:alert(1)' }] })
    expect(html).not.toContain('javascript:'); expect(html).toContain('<img')
  })
  it('empty input renders nothing', () => { expect(renderMarkdown('', ctx)).toEqual({ html: '', headings: [] }) })
})

describe('counts and helpers', () => {
  it('words, reading time and excerpt ignore markdown syntax and markers', () => {
    const md = '## عنوان\nكلمة **مهمة** و[رابط](/x) هنا\n- نقطة\n{{image:1}}'
    expect(plainText(md)).toBe('عنوان كلمة مهمة ورابط هنا نقطة')
    expect(wordCount(md)).toBe(6); expect(wordCount('')).toBe(0)
    expect(readingMinutes('كلمة '.repeat(1000))).toBe(5); expect(readingMinutes('')).toBe(1)
    expect(excerpt('كلمة '.repeat(100), 30).length).toBeLessThanOrEqual(31)
  })
  it('youtubeId accepts ids and the common URL shapes, rejects the rest', () => {
    for (const s of ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ']) expect(youtubeId(s)).toBe('dQw4w9WgXcQ')
    for (const s of ['', 'abc', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=<script>']) expect(youtubeId(s)).toBeNull()
  })
})
