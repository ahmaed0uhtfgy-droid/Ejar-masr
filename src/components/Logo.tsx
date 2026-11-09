/**
 * Ejar Masr emblem (SVG, scales cleanly, no external image).
 * Pass a unique `uid` when rendering more than one on a page (gradient ids must differ).
 */
export function Logo({ size = 40, uid = 'lg', className }: { size?: number; uid?: string; className?: string }) {
  const g = `${uid}-gold`
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width={size} height={size}
      className={className} role="img" aria-label="إيجار مصر"
    >
      <defs>
        <linearGradient id={g} gradientUnits="userSpaceOnUse" x1="10" y1="10" x2="110" y2="110">
          <stop offset="0" stopColor="#F4D98A" />
          <stop offset="0.5" stopColor="#D4A537" />
          <stop offset="1" stopColor="#9C7415" />
        </linearGradient>
      </defs>
      {/* medallion */}
      <circle cx="60" cy="60" r="57" fill="#0B1B3A" stroke={`url(#${g})`} strokeWidth="4" />
      <circle cx="60" cy="60" r="50" fill="none" stroke={`url(#${g})`} strokeWidth="1.2" opacity="0.8" />
      {/* network lines (as in the logo) */}
      <g stroke={`url(#${g})`} strokeWidth="0.7" opacity="0.35" fill="none">
        <path d="M24 70 40 48 60 34 82 46 96 68" />
        <path d="M40 48 60 62 82 46" />
        <path d="M30 86 60 62 92 88" />
      </g>
      <g fill="#D4A537" opacity="0.6">
        <circle cx="24" cy="70" r="1.6" /><circle cx="40" cy="48" r="1.6" /><circle cx="82" cy="46" r="1.6" /><circle cx="96" cy="68" r="1.6" />
      </g>
      {/* pyramid */}
      <path d="M60 17 67 27H53Z" fill={`url(#${g})`} />
      {/* skyline towers */}
      <g fill="#0B1B3A" stroke={`url(#${g})`} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round">
        <path d="M43 88V58l9-6v36" />
        <path d="M52 88V40l10-8 10 6v50" />
        <path d="M72 88V62l16 6v20" />
      </g>
      <g stroke={`url(#${g})`} strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
        <path d="M57 48v34M62 44v38M77 70v14M83 72v12M47 64v18" />
      </g>
      <path d="M36 88h56" stroke={`url(#${g})`} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
