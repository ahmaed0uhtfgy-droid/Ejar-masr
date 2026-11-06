/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        mute: 'rgb(var(--c-mute) / <alpha-value>)',
        nile: 'rgb(var(--c-nile) / <alpha-value>)',
        'nile-dark': 'rgb(var(--c-nile-dark) / <alpha-value>)',
        sand: 'rgb(var(--c-sand) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Reem Kufi"', 'Tahoma', 'sans-serif'],
        body: ['"IBM Plex Sans Arabic"', 'Tahoma', 'sans-serif'],
      },
      borderRadius: { field: '10px', panel: '16px', hero: '28px' },
    },
  },
  plugins: [],
}
