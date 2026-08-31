import type { Config } from 'tailwindcss'

/**
 * Traces is an instrument, not a landing page. The palette is deliberately narrow and dark, and the
 * type scale is small — see the UI conventions in CONTRIBUTING.md before adding anything here.
 *
 * Three of the scales below are *replaced* rather than extended, and that is the point of them:
 *
 *   - `borderRadius` stops at 6px, so `rounded-lg` and friends do not exist. A panel that reads as a
 *     marketing card is one `rounded-2xl` away, and the cheapest way to not have that argument is for
 *     the class to not resolve.
 *   - `boxShadow` holds two inset highlights and `none`. Depth here comes from surface value and a
 *     lighter top edge, never from a drop shadow — an instrument does not float.
 *   - `fontSize` is named by *role*, not by size, because the sizes are the thing that kept drifting.
 *     Every component used to carry its own `text-[10px]`, and a hundred of those cannot be raised
 *     together. Ask for `text-body` and the floor moves in one file.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    /**
     * Small for controls and chips, medium for panels, and nothing beyond. Both values are small
     * enough to read as machined rather than soft, which is the whole reason to have any radius at
     * all: a 3px corner says "this is a button" without saying "this is a website".
     */
    borderRadius: {
      none: '0',
      sm: '3px',
      DEFAULT: '3px',
      md: '6px',
      /** Dots only — a status light, a bisect probe. Never a container. */
      full: '9999px',
    },

    /**
     * Elevation without shadows. A raised surface is lit along its top edge, the way a physical panel
     * set into a darker chassis is, and it is paired with `border-line-strong` at the call site so the
     * whole outline lifts rather than just the one edge.
     */
    boxShadow: {
      none: 'none',
      panel: 'inset 0 1px 0 rgb(255 255 255 / 0.03)',
      raised: 'inset 0 1px 0 rgb(255 255 255 / 0.05)',
    },

    extend: {
      colors: {
        // Surfaces, darkest to lightest.
        base: '#0e1013',
        panel: '#15181d',
        raised: '#1c2027',

        // Borders. `strong` is for a raised surface, whose outline has to lift with it — the inset
        // highlight alone leaves three sides sitting at the same value as the surface below.
        line: {
          DEFAULT: '#272c34',
          strong: '#343b45',
        },

        // Text. `faint` is pinned by contrast rather than by taste: it is used on eleven different
        // grounds, and at this value it clears WCAG AA (4.5:1) on all of them. `raised` is the binding
        // one, being the lightest, at 4.51:1 — anything dimmer fails there. The 3:1 large-text
        // allowance is no help, because `fontSize` below tops out at 15px and nothing here is bold.
        // The cost is that it now sits 11 per channel from `muted` instead of 48, so the two read as
        // one tone in places; that is the most separation the pair can have with both passing.
        //
        // One site is still short of AA, and no value here can fix it: the rejected hypothesis card in
        // `hypothesis-cards.tsx` carries `opacity-60`, which veils text and ground together, so no
        // foreground can outrun it — 2.61:1 for `faint`, and 2.90:1 for `muted` in the same card.
        ink: '#e6e8eb',
        muted: '#8b929c',
        faint: '#808791',

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
        // IBM Plex Sans and Plex Mono, one superfamily so the two can share a line without a step in
        // it. Declared in src/app/fonts.ts, which is where the reasoning lives; these are the CSS
        // variables next/font defines, with the platform stack behind them for the swap window.
        sans: ['var(--font-plex-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        /**
         * 10px, and the only thing allowed here is a glyph: a `kbd` key cap, a timeline tick label, an
         * ordinal beside a control. Anything that forms a phrase takes `label` or larger. This is the
         * one size that survived the pass, and it survived because a two-character key cap set at 12px
         * is wider than the word it sits beside.
         */
        micro: ['0.625rem', { lineHeight: '0.875rem' }],
        /** 11px. Uppercase section labels, status chips, author badges, counts. */
        label: ['0.6875rem', { lineHeight: '1rem' }],
        /** 12px. Mono metadata, secondary notes, the second line of a two-line row. */
        meta: ['0.75rem', { lineHeight: '1.125rem' }],
        /** 13px. Body copy, and the floor for anything that is a sentence someone has to read. */
        body: ['0.8125rem', { lineHeight: '1.25rem' }],
        /** 15px. The wordmark, and a panel title that has to win against the body under it. */
        title: ['0.9375rem', { lineHeight: '1.25rem' }],
      },
      transitionDuration: {
        /**
         * 120ms, on everything that does not say otherwise. Long enough that a hover reads as a
         * response rather than a repaint, short enough that a pointer crossing four controls does not
         * leave a trail behind it. Nothing in this app animates for longer.
         */
        DEFAULT: '120ms',
      },
    },
  },
  plugins: [],
}

export default config
