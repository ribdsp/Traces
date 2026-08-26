import type { DigestEvent, Recording } from '@/types/domain'
import {
  collectNavigations,
  isClickEvent,
  isConsoleEvent,
  isInputEvent,
  isNetworkFailureEvent,
} from './rrweb-events'

/** `list_events` never returns more than this. A longer list teaches an agent less, not more. */
export const DIGEST_LIMIT = 40

/** A run of clicks on the same target joins if consecutive clicks land within this many ms. */
const RAGE_CLICK_WINDOW_MS = 1000
/** A run shorter than this is just repeated clicking, not a `rageClick`. */
const RAGE_CLICK_THRESHOLD = 3
/** One digest line, already truncated to roughly this length. */
const SUMMARY_MAX_CHARS = 120

export type DigestOptions = {
  fromMs?: number
  toMs?: number
  kinds?: DigestEvent['kind'][]
  limit?: number
}

function truncateSummary(text: string): string {
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…` : text
}

/** A console call's payload, rendered as one line without assuming its items are strings. */
function describeLogPayload(payload: unknown[]): string {
  return payload.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' ')
}

type ClickCandidate = { atMs: number; nodeId: number }

/**
 * Collapse a run of `RAGE_CLICK_THRESHOLD` or more clicks on the same node, each no more than
 * `RAGE_CLICK_WINDOW_MS` after the previous one, into a single `rageClick`. Everything outside a
 * qualifying run is emitted as an ordinary `click`.
 *
 * Grouped by rrweb's own node id, not a CSS selector: resolving that id back to a selector needs the
 * reconstructed mirror DOM, which this module deliberately does not have (see rrweb-events.ts). The
 * numeric id goes in the summary text instead, and `DigestEvent.selector` is left unset for clicks —
 * a `nodeId` field on `DigestEvent` would let a caller re-identify the element without one, but
 * `types/domain.ts` is frozen, so this is a proposal rather than a change.
 */
function collapseRageClicks(clicks: ClickCandidate[]): DigestEvent[] {
  const result: DigestEvent[] = []
  let run: ClickCandidate[] = []

  const flushRun = () => {
    const [first] = run
    if (first === undefined) return
    if (run.length >= RAGE_CLICK_THRESHOLD) {
      result.push({
        atMs: first.atMs,
        kind: 'rageClick',
        summary: truncateSummary(
          `Rage-clicked the same element ${run.length} times (node ${first.nodeId}).`,
        ),
      })
    } else {
      for (const click of run) {
        result.push({ atMs: click.atMs, kind: 'click', summary: `Clicked node ${click.nodeId}.` })
      }
    }
    run = []
  }

  for (const click of clicks) {
    const previous = run[run.length - 1]
    const continuesRun =
      previous !== undefined &&
      previous.nodeId === click.nodeId &&
      click.atMs - previous.atMs <= RAGE_CLICK_WINDOW_MS
    if (!continuesRun) flushRun()
    run.push(click)
  }
  flushRun()

  return result
}

/**
 * Reduce thousands of rrweb events to the short list worth an agent's attention.
 *
 * Owner: Riko.
 *
 * Keeps clicks (rage-clicks collapsed, see `collapseRageClicks`), inputs (length only — see
 * docs/threat-model.md T4, values are never echoed), navigations, console errors/warnings, and failed
 * requests; drops everything else (mouse movement, scroll, plain mutations) as noise at this level.
 * `fromMs`/`toMs`/`kinds` filter the result; on truncation to `limit` (default `DIGEST_LIMIT`) the
 * *earliest* events are kept, since an agent reasoning about a first occurrence needs the start of
 * the window, not a random slice of it.
 */
export function buildEventDigest(
  recording: Recording,
  options: DigestOptions = {},
): { events: DigestEvent[]; truncated: boolean } {
  const { startedAt, events } = recording
  const fromMs = options.fromMs ?? 0
  const toMs = options.toMs ?? recording.durationMs
  const limit = options.limit ?? DIGEST_LIMIT
  const withinWindow = (atMs: number) => atMs >= fromMs && atMs <= toMs

  const clickCandidates: ClickCandidate[] = events.filter(isClickEvent).map((event) => ({
    atMs: event.timestamp - startedAt,
    nodeId: event.data.id,
  }))
  const clickEvents = collapseRageClicks(clickCandidates)

  const inputEvents: DigestEvent[] = events.filter(isInputEvent).map((event) => ({
    atMs: event.timestamp - startedAt,
    kind: 'input',
    summary: truncateSummary(`Typed ${event.data.text.length} character(s) into an input.`),
  }))

  // Real navigations only — one Meta event per checkout would otherwise fill the digest with
  // restatements of a URL that never changed. See `collectNavigations`.
  const navigationEvents: DigestEvent[] = collectNavigations(events, startedAt).map((navigation) => ({
    atMs: navigation.atMs,
    kind: 'navigation',
    summary: truncateSummary(`Navigated to ${navigation.url}`),
  }))

  const consoleEvents: DigestEvent[] = events
    .filter(isConsoleEvent)
    .filter((event) => event.data.level === 'error' || event.data.level === 'warn')
    .map((event) => ({
      atMs: event.timestamp - startedAt,
      kind: event.data.level === 'error' ? ('consoleError' as const) : ('consoleWarn' as const),
      summary: truncateSummary(describeLogPayload(event.data.payload)),
    }))

  const networkEvents: DigestEvent[] = events.filter(isNetworkFailureEvent).map((event) => {
    const { url, status } = event.data.payload
    return {
      atMs: event.timestamp - startedAt,
      kind: 'failedRequest',
      summary: truncateSummary(`Request to ${url} failed${status ? ` with status ${status}` : ''}.`),
    }
  })

  const kinds = options.kinds
  const all = [...clickEvents, ...inputEvents, ...navigationEvents, ...consoleEvents, ...networkEvents]
    .filter((event) => withinWindow(event.atMs))
    .filter((event) => !kinds || kinds.includes(event.kind))
    .sort((a, b) => a.atMs - b.atMs)

  const truncated = all.length > limit
  return { events: truncated ? all.slice(0, limit) : all, truncated }
}
