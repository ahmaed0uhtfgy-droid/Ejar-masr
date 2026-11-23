/**
 * The two site designs the admin can switch between (Admin > المظهر).
 * Pure data, no DOM: the browser code (src/lib/design.ts) and the edge functions (blog pages) both import it.
 *  - classic: ivory page, navy + gold, Reem Kufi headings. Keeps the light / dark toggle.
 *  - royal:   deep navy "royal" look with gold lattice, Cairo + Montserrat. Always dark (the toggle is hidden).
 */
export type DesignId = 'classic' | 'royal'

export const DEFAULT_DESIGN: DesignId = 'classic'

export const DESIGN_IDS: readonly DesignId[] = ['classic', 'royal']

export interface DesignInfo { id: DesignId; name: string; tagline: string; description: string; preview: string; themeColor: string }

export const DESIGNS: Record<DesignId, DesignInfo> = {
  classic: {
    id: 'classic', name: 'التصميم الكلاسيكي', tagline: 'عاجي هادئ',
    description: 'خلفية عاجية فاتحة، كحلي وذهبي، عناوين Reem Kufi. بيدعم الوضع الفاتح والداكن للزائر.',
    preview: '/design/classic-hero.webp', themeColor: '#0B1B3A',
  },
  royal: {
    id: 'royal', name: 'التصميم الملكي', tagline: 'كحلي داكن بزخرفة ذهبية',
    description: 'كحلي ملكي عميق، شبكة ذهبية، حركة عند التمرير، خط Cairo. دايمًا داكن.',
    preview: '/design/royal-tower.webp', themeColor: '#061431',
  },
}

/** Anything unknown (old settings documents have no `design`, or a typo) falls back to the default instead of breaking the page. */
export function normalizeDesign(v: unknown): DesignId {
  return v === 'royal' || v === 'classic' ? v : DEFAULT_DESIGN
}
