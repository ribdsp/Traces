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

const SCENARIO_KEY = 'bugbait:scenario'

/**
 * Read `?bug=` once, remember it for the rest of the browser session, and take it back out of the
 * address bar.
 *
 * The stripping is the load-bearing half. rrweb stamps `window.location.href` into every Meta event,
 * and `read_session_meta` hands those URLs to the agent as the session's routes — so a recording made
 * at `/checkout?bug=empty-province` opens by telling the agent which bug it is looking for, and the
 * investigation becomes a re-enactment. Removing the parameter before the first snapshot costs nothing:
 * the URL you *type* is still `/checkout?bug=empty-province`, so the scenario is as reproducible as it
 * was, and `sessionStorage` carries it across the navigation from the cart and across a reload.
 *
 * Returns null rather than throwing when storage is unavailable — a private-mode browser that cannot
 * remember the scenario should still render an ordinary, working checkout.
 */
export function armScenario(): Bug | null {
  if (typeof window === 'undefined') return null

  const fromUrl = activeBug(window.location.search)
  try {
    if (fromUrl) {
      window.sessionStorage.setItem(SCENARIO_KEY, fromUrl)
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
      return fromUrl
    }
    const stored = window.sessionStorage.getItem(SCENARIO_KEY)
    return isBug(stored) ? stored : null
  } catch {
    return fromUrl
  }
}

/** Forgets the armed scenario, so the next take starts from a known state. */
export function disarmScenario(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(SCENARIO_KEY)
  } catch {
    // Nothing to clear if storage was never available.
  }
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

/*
 * Day 5 (vicko) — implemented. Where each half of that assignment landed, so whoever changes a bug
 * next knows which file to open:
 *
 *   - the bugs themselves live in `app/checkout/page.tsx`, driven by `activeBug(location.search)`
 *   - the endpoints are stubbed *inside* this app — `app/api/provinces/route.ts` and
 *     `app/api/cities/route.ts` — so a recording contacts no third party and reproduces offline
 *   - the timings are the constants below, kept here rather than inline so a take stays comparable
 *   - the mechanism is never logged. The only console output any bug produces is the same misleading
 *     validation line the UI already shows the user; see `MISLEADING_POSTCODE_ERROR`
 */

/**
 * How the armed scenario reaches the API stubs.
 *
 * A request header, deliberately, and not a query parameter — `GET /api/provinces?bug=empty-province`
 * would name the bug inside the recorded network log, and the recorder records URLs. The agent is
 * supposed to notice that a `200 OK` came back holding `array, 0 items`; it is not supposed to be
 * handed the answer in the query string. Headers are not recorded (see lib/record.ts), so this stays
 * out of the evidence.
 */
export const SCENARIO_HEADER = 'x-bugbait-scenario'

/**
 * Stub latency, in ms.
 *
 * `provinces` is the load-bearing one. The request fires when /checkout mounts and resolves this long
 * after, which — following the recording procedure in README.md, where the cart takes about ten
 * seconds — puts it at roughly 12s into the session. The symptom does not surface until the second
 * step of the form, around 28s. That gap of ~16 seconds between cause and symptom is the entire
 * reason `bisect` exists, so it is a number worth keeping stable rather than tuning for feel.
 *
 * `cities` is shorter than the time it takes a human to read the step-2 heading, which is what makes
 * the race bug reproduce every time: the select is mounted and painted before the response lands.
 */
export const LATENCY_MS: Readonly<Record<'provinces' | 'cities', number>> = {
  provinces: 1500,
  cities: 900,
}

/**
 * How long after the payment step appears before the promo banner drops over the Pay button.
 *
 * Not zero, on purpose: the button is genuinely clickable for these four seconds. That gives the
 * overlay bug a transition in time — `bisect` on `#promo-strip` existing finds a real edge — rather
 * than a page that was simply born broken, which no amount of searching the timeline would reveal.
 */
export const PROMO_DELAY_MS = 4000

/**
 * The error the form shows when submission is blocked.
 *
 * Attached to `#postcode`, which is not the field at fault, in every scenario. This is the whole
 * point of the demo and not an oversight: the investigation is not "submit is disabled", it is "the
 * reason submit is disabled is not where the UI says it is".
 */
export const MISLEADING_POSTCODE_ERROR = 'We could not verify this postcode for your region.'
