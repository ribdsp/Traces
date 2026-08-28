import type { RrwebEvent } from '@/types/domain'

/**
 * Narrowing predicates over rrweb's raw event `data`, shared by load-recording.ts (recording-level
 * counts) and event-digest.ts (the digest itself).
 *
 * Kept in one place so the two files can never classify the same event two different ways, and kept
 * dependency-free on purpose: these read the plain JSON shape rrweb produces, never the rrweb package
 * itself, which is what lets `lib/replay`'s tests run in milliseconds without a browser (see
 * CONTRIBUTING.md). The numeric constants below mirror rrweb's own `EventType` / `IncrementalSource` /
 * `MouseInteractions` enums (confirmed against `@rrweb/types` in node_modules); they are hardcoded
 * rather than imported so this file stays free of the dependency, same reasoning as
 * checkpoint-index.ts's own `FULL_SNAPSHOT` constant.
 */

const EVENT_TYPE_INCREMENTAL_SNAPSHOT = 3
const EVENT_TYPE_META = 4
const EVENT_TYPE_FULL_SNAPSHOT = 2
const EVENT_TYPE_CUSTOM = 5

const SOURCE_MOUSE_INTERACTION = 2
const SOURCE_INPUT = 5
const SOURCE_LOG = 11

/** rrweb's MouseInteractions.Click. Every other mouse interaction (focus, blur, ...) is ignored. */
const MOUSE_INTERACTION_CLICK = 2

/**
 * The custom-event tag a recorder is expected to use for a failed network request.
 *
 * rrweb has no built-in network capture, so this is this project's own convention, not something
 * rrweb defines: `record.addCustomEvent('network-request', { url, status, ok: false })`. The recorder
 * that would actually emit this — bugbait's lib/record.ts — is not implemented yet (see its Day 5
 * TODO), so treat this as the current best guess rather than a settled contract, and confirm it once
 * that recorder exists.
 */
const NETWORK_REQUEST_CUSTOM_TAG = 'network-request'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type MetaEventData = { href: string; width: number; height: number; userAgent?: string }

/**
 * rrweb's own Meta event payload is `{ href, width, height }` — it does not carry a user agent.
 * `userAgent` is read here only opportunistically, for a recorder that chooses to add it; its absence
 * is not a validation failure. See load-recording.ts for the fallback when it is missing.
 */
export function isMetaEventData(data: unknown): data is MetaEventData {
  return (
    isRecord(data) &&
    typeof data.href === 'string' &&
    typeof data.width === 'number' &&
    typeof data.height === 'number' &&
    (data.userAgent === undefined || typeof data.userAgent === 'string')
  )
}

/**
 * A Meta event. **Not** the same thing as a navigation — see `collectNavigations`.
 */
export function isMetaEvent(event: RrwebEvent): event is RrwebEvent & { data: MetaEventData } {
  return event.type === EVENT_TYPE_META && isMetaEventData(event.data)
}

export type Navigation = { atMs: number; url: string }

/**
 * The navigations in a recording: the initial page load, plus each later move to a *different* URL.
 *
 * The deduplication is the entire point of this function, and it is not defensive programming — it
 * fixes a wrong claim that a real recording produced. **rrweb emits a fresh Meta event alongside every
 * checkout FullSnapshot**, not only on navigation. Measured on a 3.5-second recording of a page that
 * never navigated once, with `record({ checkoutEveryNms: 1000 })`: four Meta events, at 0, 1084, 2393
 * and 3518 ms — the same instants as the four checkpoints, all carrying the identical `href`.
 *
 * Mapping Meta one-to-one onto navigations therefore reported four navigations for zero, and it was
 * wrong in the direction that matters. Three consequences, each worse than the last:
 *
 *  - `RecordingMeta.navigations` gets phantom entries, so a timeline drawing navigation boundaries
 *    draws three that never happened.
 *  - the digest spends four of its seven entries restating one URL, crowding out real events under
 *    `DIGEST_LIMIT`.
 *  - `buildReport` synthesizes steps from the digest and marks them `verified: true` — correctly, by
 *    its own reasoning, since each *is* a real recorded event. So a reproduction would have read
 *    "Navigated to /checkout" four times, as verified fact, about a session with no navigation in it.
 *    That is the fabrication build-report.ts exists to prevent, arriving through the one channel it
 *    trusts by construction, and no fixture would ever catch it: a test author writing a recording by
 *    hand writes one Meta event, because one is what the mental model says.
 *
 * Keeping the first Meta unconditionally is deliberate — the opening URL is a real navigation, and
 * "open this page" is a legitimate first step of any reproduction.
 */
export function collectNavigations(events: RrwebEvent[], startedAt: number): Navigation[] {
  const navigations: Navigation[] = []
  let previousUrl: string | null = null

  for (const event of events) {
    if (!isMetaEvent(event)) continue
    const url = event.data.href
    if (url === previousUrl) continue
    navigations.push({ atMs: event.timestamp - startedAt, url })
    previousUrl = url
  }

  return navigations
}

/** A full DOM snapshot — see checkpoint-index.ts for why its positions matter. */
export function isFullSnapshotEvent(event: RrwebEvent): boolean {
  return event.type === EVENT_TYPE_FULL_SNAPSHOT
}

export type MouseInteractionData = { source: number; type: number; id: number; x?: number; y?: number }

function isMouseInteractionData(data: unknown): data is MouseInteractionData {
  return (
    isRecord(data) &&
    data.source === SOURCE_MOUSE_INTERACTION &&
    typeof data.type === 'number' &&
    typeof data.id === 'number'
  )
}

/**
 * A click, specifically — rrweb reports every mouse interaction (focus, blur, mouseup, ...) on the
 * same source, and only `MouseInteractions.Click` is interesting at digest level.
 *
 * `id` is rrweb's own mirror node id, not a CSS selector. Resolving it to a selector needs the
 * reconstructed mirror DOM, which this module deliberately does not have — see event-digest.ts.
 */
export function isClickEvent(event: RrwebEvent): event is RrwebEvent & { data: MouseInteractionData } {
  return (
    event.type === EVENT_TYPE_INCREMENTAL_SNAPSHOT &&
    isMouseInteractionData(event.data) &&
    event.data.type === MOUSE_INTERACTION_CLICK
  )
}

export type InputEventData = { source: number; id: number; text: string; isChecked: boolean }

/**
 * A keystroke into a form field. `text` is whatever the recorder captured — masked to a
 * length-preserving placeholder when `maskAllInputs` is on, per bugbait's recorder — but this module
 * never reads its content, only its length. See docs/threat-model.md T4.
 */
export function isInputEvent(event: RrwebEvent): event is RrwebEvent & { data: InputEventData } {
  const { data } = event
  return (
    event.type === EVENT_TYPE_INCREMENTAL_SNAPSHOT &&
    isRecord(data) &&
    data.source === SOURCE_INPUT &&
    typeof data.id === 'number' &&
    typeof data.text === 'string'
  )
}

export type LogEventData = { source: number; level: string; payload: unknown[] }

/**
 * A console call, captured by rrweb's console-record plugin on `IncrementalSource.Log`. The base
 * `rrweb` package (this version) does not export a type for this payload, so `{ level, payload }`
 * below is this project's own understanding of that plugin's contract, not something checked against
 * a real recording yet — bugbait's recorder does not exist yet either. Confirm this shape once it
 * does.
 */
export function isConsoleEvent(event: RrwebEvent): event is RrwebEvent & { data: LogEventData } {
  const { data } = event
  return (
    event.type === EVENT_TYPE_INCREMENTAL_SNAPSHOT &&
    isRecord(data) &&
    data.source === SOURCE_LOG &&
    typeof data.level === 'string' &&
    Array.isArray(data.payload)
  )
}

export type NetworkFailurePayload = { url: string; status?: number; ok: boolean }
export type NetworkFailureData = { tag: string; payload: NetworkFailurePayload }

/**
 * A failed network request, reported as a Custom event under the convention documented on
 * `NETWORK_REQUEST_CUSTOM_TAG` above.
 */
export function isNetworkFailureEvent(event: RrwebEvent): event is RrwebEvent & { data: NetworkFailureData } {
  const { data } = event
  if (event.type !== EVENT_TYPE_CUSTOM || !isRecord(data)) return false
  if (data.tag !== NETWORK_REQUEST_CUSTOM_TAG || !isRecord(data.payload)) return false
  return typeof data.payload.url === 'string' && data.payload.ok === false
}
