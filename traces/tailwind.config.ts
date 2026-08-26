import type { Config } from 'tailwindcss'

/**
 * Traces is an instrument, not a landing page. The palette is deliberately narrow and dark, and the
 * type scale is small — see the UI conventions in CONTRIBUTING.md before adding anything here.
 *
 * Owner: Faiq.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces, darkest to lightest.
        base: '#0e1013',
        panel: '#15181d',
        raised: '#1c2027',
        line: '#272c34',

        // Text.
        ink: '#e6e8eb',
        muted: '#8b929c',
        faint: '#5b626c',

        // Authorship. These two carry meaning, not decoration: every marker, hypothesis and
        // activity entry is tinted by who created it. Do not reuse them for anything else.
        human: '#4ea1ff',
        agent: '#c08bff',

        // Event severities on the timeline.
        error: '#ff6b6b',
        warn: '#f0b429',
        ok: '#3ecf8e',
      },
      fontFamily: {
        // Placeholder. Faiq picks the real pair on Day 6; system-ui as "the design" is banned.
        sans: ['ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Dense by default.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}

export default config
