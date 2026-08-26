/**
 * The bugs, as data.
 *
 * Owner: Vicko.
 *
 * Every bug is selected with a query parameter — `/checkout?bug=empty-province` — for one reason: the
 * recording has to be reproducible. Anyone cloning this repo must be able to produce the same session
 * we did, or the sample recordings are magic artefacts nobody can regenerate. A bug that only happens
 * on someone's machine is not a fixture, it is a story.
 *
 * Each bug is also chosen to be *invisible in the DOM at the moment it matters*, which is the whole
 * argument of the project. Reading the final DOM tells you the submit button is disabled. It does not
 * tell you that a request twelve seconds earlier returned an empty array, and no amount of looking at
 * the end state recovers that.
 */

export const BUGS = ['empty-province', 'race', 'overlay'] as const

export type Bug = (typeof BUGS)[number]

export function isBug(value: string | null | undefined): value is Bug {
  return typeof value === 'string' && (BUGS as readonly string[]).includes(value)
}

/** Reads `?bug=` from the current URL. Returns null for anything unrecognised — never throws. */
export function activeBug(search: string): Bug | null {
  const value = new URLSearchParams(search).get('bug')
  return isBug(value) ? value : null
}

export type BugSpec = {
  bug: Bug
  /** One line, shown in the dev banner so whoever is recording knows what they armed. */
  label: string
  /** What the *user* experiences. This is what a bug report would say. */
  symptom: string
  /** What actually happens. Never shown in the UI — it would give the answer away in the recording. */
  mechanism: string
}

/**
 * Documented here rather than in a README, because whoever changes the timing of one of these bugs is
 * editing this file and needs the intent in front of them.
 *
 * A note on `empty-province`, the primary demo bug: the request must return `200` with `[]`, not an
 * error. A 500 would show up in the network tab and the investigation would take four seconds. The
 * whole point is a request that *succeeded* and still broke the page — which is why the agent has to
 * bisect the timeline rather than read a stack trace.
 */
export const BUG_SPECS: Record<Bug, BugSpec> = {
  'empty-province': {
    bug: 'empty-province',
    label: 'Province list comes back empty',
    symptom:
      'The province dropdown looks fine but has nothing in it. Submit stays disabled and the error message blames the postcode.',
    mechanism:
      'GET /api/provinces resolves 200 with an empty array. The select renders zero options, validation fails on a field the user cannot fill, and the error text is attached to the wrong field.',
  },
  race: {
    bug: 'race',
    label: 'Dropdown renders before its data arrives',
    symptom: 'Sometimes the city dropdown is empty and stays empty, even though the data loaded.',
    mechanism:
      'The options are read once during the first render, before the fetch resolves, and nothing re-reads them. The ordering is visible in the recording: DOM ready before the response.',
  },
  overlay: {
    bug: 'overlay',
    label: 'Pay button is covered',
    symptom: 'Clicking Pay does nothing. No error, no spinner, no network request.',
    mechanism:
      'A promo banner with a higher z-index sits over the button with opacity near zero. Clicks land on the banner. Nothing in the DOM looks wrong — only geometry reveals it, which is what measure_layout is for.',
  },
}

/**
 * TODO(vicko), Day 5:
 *   - implement each bug inside the checkout page, driven by `activeBug(location.search)`
 *   - keep the timing stable: the empty-province request should resolve at a consistent moment (~12s
 *     into a natural interaction) so the recording is comparable across takes
 *   - never log the mechanism to the console. A recording that contains the answer in plain text makes
 *     the whole investigation theatre, and a judge will notice
 *   - no real network calls to anything external: stub the endpoints inside the app so the recordings
 *     are self-contained and no third party appears in them
 */
