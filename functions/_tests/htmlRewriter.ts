/**
 * Minimal stand-in for Cloudflare's HTMLRewriter (it only exists in the Workers runtime), implementing exactly the four selectors renderShell uses:
 * title, meta[name="description"], head (append) and div#root (append). Lets the SEO tests run the real page generators.
 */
interface El { setInnerContent(s: string): void; setAttribute(k: string, v: string): void; append(s: string, o?: { html: boolean }): void }
type Handler = { element?(e: El): void }
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export class FakeHTMLRewriter {
  private rules: { selector: string; h: Handler }[] = []
  on(selector: string, h: Handler): this { this.rules.push({ selector, h }); return this }
  transform(res: Response): Response {
    const rules = this.rules
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        let html = await res.text()
        for (const { selector, h } of rules) {
          const ops: { inner?: string; attrs: [string, string][]; append: string[] } = { attrs: [], append: [] }
          h.element?.({ setInnerContent: (s) => { ops.inner = s }, setAttribute: (k, v) => { ops.attrs.push([k, v]) }, append: (s, o) => { ops.append.push(o?.html ? s : esc(s)) } })
          if (selector === 'title' && ops.inner !== undefined) html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(ops.inner as string)}</title>`)
          if (selector === 'meta[name="description"]') for (const [k, v] of ops.attrs) html = html.replace(/<meta name="description"[^>]*>/, () => `<meta name="description" ${k}="${v.replace(/"/g, '&quot;')}" />`)
          if (selector === 'head' && ops.append.length) html = html.replace('</head>', () => `${ops.append.join('')}</head>`)
          if (selector === 'div#root' && ops.append.length) html = html.replace(/(<div id="root">)([\s\S]*?)(<\/div>)/, (_m, a, b, d) => `${a}${b}${ops.append.join('')}${d}`)
        }
        c.enqueue(new TextEncoder().encode(html)); c.close()
      },
    })
    return new Response(body, { status: res.status, headers: res.headers })
  }
}
