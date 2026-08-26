'use client'

import { getRecordConsolePlugin } from '@rrweb/rrweb-plugin-console-record'
import { record } from 'rrweb'

/**
 * Records the session and hands back a JSON file Traces can load.
 *
 * Owner: Vicko.
 *
 * Two decisions here that matter more than the code:
 *
 * **Record inputs as masked.** rrweb can capture every keystroke, and this is a checkout form —
 * addresses, card fields, whatever someone types while making a demo. `maskAllInputs: true` records
 * that a field was typed into and how long the value was, never the value. That is also exactly what
 * the agent needs: `list_events` reports "typed 16 characters into #card", which answers the question
 * without ever putting a card number in a JSON file that lands in a public repo. See
 * docs/threat-model.md.
 *
 * **Everything committed to the repo comes from here.** Never from a real site and never from a real
 * person's session. A recording is a full reconstruction of a page and everything on it; the only
 * recordings safe to publish are the synthetic ones this app produces.
 */

/**
 * The structural minimum of an rrweb event, mirroring `RrwebEvent` in traces/src/types/domain.ts.
 *
 * Declared here rather than imported because the two apps are separate packages with separate
 * `tsconfig` roots. If that type ever changes, this is the line that has to change with it.
 */
export type RecordedEvent = {
  type: number
  timestamp: number
  data: unknown
}

/**
 * The download payload, mirroring `Recording` in traces/src/types/domain.ts.
 *
 * `meta` is deliberately partial: `loadRecording` derives event counts, navigations and viewport from
 * the events themselves, so restating them here would create two sources of truth that can disagree.
 * `userAgent` is the exception — see `withUserAgent`.
 */
export type RecordingFile = {
  id: string
  label: string
  events: RecordedEvent[]
  startedAt: number
  durationMs: number
  meta: { userAgent: string; viewport: { width: number; height: number } }
}

export type RecorderHandle = {
  stop: () => void
  eventCount: () => number
  /** Triggers a browser download of the recording as JSON. */
  download: (filename?: string) => void
  /**
   * Forces an immediate Meta + FullSnapshot pair. Called when the app moves between pages: rrweb only
   * refreshes `href` at a checkout, so without this the navigation into /checkout is timestamped at
   * the next 5-second boundary and `read_session_meta` reports it up to 5s late.
   */
  markNavigation: () => void
  /**
   * The three numbers worth reading before trusting a take, shown in the recorder UI.
   *
   * `fullSnapshots` and `metaEvents` should both be roughly `durationMs / 5000`, and they should be
   * equal: rrweb emits them in pairs, and a mismatch means something is emitting snapshots without
   * refreshing `href`, which is the failure that looks like a slow bisect.
   */
  summary: () => RecordingSummary
}

export type RecordingSummary = {
  total: number
  fullSnapshots: number
  metaEvents: number
  durationMs: number
}

// rrweb's own EventType numbers. Hardcoded rather than imported for the same reason traces's
// lib/replay hardcodes them: this file is the only place in bugbait that needs them.
const EVENT_TYPE_FULL_SNAPSHOT = 2
const EVENT_TYPE_INCREMENTAL_SNAPSHOT = 3
const EVENT_TYPE_META = 4
const EVENT_TYPE_PLUGIN = 6

/** rrweb's `IncrementalSource.Log`, which is what `isConsoleEvent` in traces keys on. */
const SOURCE_LOG = 11

/** The name `@rrweb/rrweb-plugin-console-record` tags its events with. */
const CONSOLE_PLUGIN_NAME = 'rrweb/console@1'

/** The custom-event tag traces/src/lib/replay/rrweb-events.ts documents for network activity. */
const NETWORK_REQUEST_TAG = 'network-request'

/** Keep a summarised key list from growing without bound on a wide object. */
const MAX_SUMMARISED_KEYS = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Re-shape the console plugin's event into the shape `isConsoleEvent` expects.
 *
 * **This is a real mismatch, not a preference.** traces/src/lib/replay/rrweb-events.ts expects a
 * console call to arrive as an incremental snapshot (type 3) on `IncrementalSource.Log` (source 11),
 * which is how rrweb v1 emitted it. rrweb 2.0.0-alpha.18 routes *every* plugin through a generic
 * envelope instead — `{ type: 6, data: { plugin: 'rrweb/console@1', payload: { level, trace,
 * payload } } }`; confirmed by reading `dist/rrweb.cjs`, where the plugin callback is wrapped as
 * `{ type: EventType.Plugin, data: { plugin: p.name, payload } }`. So the version-matched plugin is
 * installed and does the capture — real levels, real stack traces, rrweb's own serialiser — but its
 * envelope would never match `isConsoleEvent`, and `counts.consoleErrors` would silently sit at 0.
 *
 * Translating in the producer keeps the fix inside the area that owns the file format and leaves
 * lib/replay untouched. The alternative — teaching `isConsoleEvent` about type 6 — is the better
 * long-term shape and is lib/replay's call to make, not this file's.
 *
 * Nothing is invented: `level`, `payload` and `trace` are the plugin's own values, and the replayer
 * ignores type-3 events whose source it does not handle (alpha.18's `applyIncremental` switch has no
 * `Log` case and no `default`), so replay and bisect are unaffected.
 */
function normaliseConsoleEvent(event: RecordedEvent): RecordedEvent {
  if (event.type !== EVENT_TYPE_PLUGIN || !isRecord(event.data)) return event
  if (event.data.plugin !== CONSOLE_PLUGIN_NAME || !isRecord(event.data.payload)) return event

  const { level, payload, trace } = event.data.payload
  if (typeof level !== 'string' || !Array.isArray(payload)) return event

  return {
    type: EVENT_TYPE_INCREMENTAL_SNAPSHOT,
    timestamp: event.timestamp,
    data: { source: SOURCE_LOG, level, payload, trace: Array.isArray(trace) ? trace : [] },
  }
}

/**
 * Add `userAgent` to every Meta event.
 *
 * rrweb's Meta payload is `{ href, width, height }` and carries no user agent, but `RecordingMeta`
 * requires the field and `loadRecording` reads it off the first Meta event, falling back to
 * `'unknown'`. `isMetaEventData` explicitly allows the extra key, so adding it here means a recording
 * reports a real user agent even when only the bare event array survives — which is what happens if
 * someone loads the events without the wrapper below.
 */
function withUserAgent(event: RecordedEvent, userAgent: string): RecordedEvent {
  if (event.type !== EVENT_TYPE_META || !isRecord(event.data)) return event
  return { ...event, data: { ...event.data, userAgent } }
}

/**
 * Describe a JSON body without reproducing any of it.
 *
 * Two independent reasons, both in docs/threat-model.md (T4): bodies are large enough to crowd out an
 * agent's context, and likely enough to hold personal data that forwarding them is a hazard rather
 * than a cost. `"array, 0 items"` is also the entire clue for the empty-province bug — the shape of
 * the answer is what matters, never its contents.
 */
export function summariseBody(body: unknown): string {
  if (body === null || body === undefined) return 'empty'
  if (Array.isArray(body)) return `array, ${body.length} items`
  if (typeof body === 'string') return `string, ${body.length} chars`
  if (typeof body === 'object') {
    const keys = Object.keys(body)
    if (keys.length === 0) return 'object, no keys'
    const shown = keys.slice(0, MAX_SUMMARISED_KEYS)
    const suffix = keys.length > shown.length ? `, +${keys.length - shown.length} more` : ''
    return `object, keys: ${shown.join(', ')}${suffix}`
  }
  return typeof body
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  return method.toUpperCase()
}

/**
 * Report every fetch as a `network-request` custom event.
 *
 * rrweb captures no network activity at all — by design, since it reconstructs the DOM rather than the
 * session's I/O — so this monkey-patch is the only source of the data behind `read_network`. Successful
 * requests are emitted too, with `ok: true`: `isNetworkFailureEvent` only cares about failures, but
 * `read_network` reports every request, and in this app the interesting request is one that *succeeded*.
 *
 * Only headers are left out, and that is not an oversight — bugbait arms its scenarios with a request
 * header precisely so the recorded evidence does not name the bug. See `SCENARIO_HEADER` in bugs.ts.
 *
 * Bodies are read only when the response declares itself JSON. Cloning and draining an arbitrary
 * response would mean buffering Next.js's own streamed RSC payloads on every client navigation, which
 * is a good way to make the app behave differently while being recorded than when it isn't.
 */
function installFetchRecorder(): () => void {
  const original = window.fetch

  const patched: typeof window.fetch = async (input, init) => {
    const url = requestUrl(input)
    const method = requestMethod(input, init)
    const startedAt = performance.now()

    try {
      const response = await original(input, init)
      const durationMs = Math.round(performance.now() - startedAt)
      const contentType = response.headers.get('content-type') ?? ''

      let bodySummary = contentType === '' ? 'not summarised' : `${contentType.split(';')[0]}, not summarised`
      if (contentType.includes('application/json')) {
        try {
          bodySummary = summariseBody((await response.clone().json()) as unknown)
        } catch {
          bodySummary = 'unparseable json'
        }
      }

      record.addCustomEvent(NETWORK_REQUEST_TAG, {
        url,
        method,
        status: response.status,
        ok: response.ok,
        durationMs,
        bodySummary,
      })
      return response
    } catch (error) {
      record.addCustomEvent(NETWORK_REQUEST_TAG, {
        url,
        method,
        status: 0,
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
        bodySummary: 'no response',
      })
      throw error
    }
  }

  window.fetch = patched
  return () => {
    window.fetch = original
  }
}

type ActiveRecorder = { handle: RecorderHandle; label: string }

/**
 * Module state, on purpose.
 *
 * The recording starts on the cart and has to survive the client-side navigation into /checkout, which
 * unmounts every component on the page. A module-level handle survives it; component state does not.
 */
let active: ActiveRecorder | null = null

/** True while a take is in progress. The recorder UI reads this so it can remove itself first. */
export function isRecording(): boolean {
  return active !== null
}

/** The handle for the take in progress, so a control mounted on a later page can stop it. */
export function currentRecorder(): RecorderHandle | null {
  return active?.handle ?? null
}

/*
 * Day 5 (vicko) — implemented. What that assignment asked for and where it is:
 *
 *   - `checkoutEveryNms` is the load-bearing option: it forces periodic full snapshots, which is what
 *     checkpoint-index.ts indexes and what makes each bisect probe cost ~1s instead of ~10s. Each one
 *     arrives as a Meta + FullSnapshot *pair* — rrweb's `takeFullSnapshot` emits the Meta first, and
 *     the replayer's seek fast path scans back for the last Meta, so a recording with snapshots and no
 *     Meta events replays every probe from zero and looks like a slow bisect rather than a bad file.
 *     README.md's verification step counts both.
 *   - events stay in a plain array, unpacked and uncompressed, because `loadRecording` expects exactly
 *     that.
 *   - `stop()` runs before `download()` can produce a file, so the tail of the session is never missing.
 */
export function startRecording(label: string): RecorderHandle {
  const existing = active
  if (existing) return existing.handle

  const events: RecordedEvent[] = []
  const userAgent = navigator.userAgent

  const stopRrweb = record({
    emit(event) {
      const plain: RecordedEvent = { type: event.type, timestamp: event.timestamp, data: event.data }
      events.push(withUserAgent(normaliseConsoleEvent(plain), userAgent))
    },
    maskAllInputs: true,
    recordCanvas: false,
    collectFonts: false,
    checkoutEveryNms: RRWEB_CHECKOUT_INTERVAL_MS,
    plugins: [getRecordConsolePlugin({ level: ['log', 'info', 'warn', 'error'] })],
  })

  if (!stopRrweb) {
    throw new Error('startRecording: rrweb declined to start. Is this running in a browser?')
  }

  const restoreFetch = installFetchRecorder()
  let stopped = false

  const handle: RecorderHandle = {
    stop() {
      if (stopped) return
      stopped = true
      restoreFetch()
      stopRrweb()
      active = null
    },
    eventCount() {
      return events.length
    },
    markNavigation() {
      if (stopped) return
      record.takeFullSnapshot(true)
    },
    summary() {
      return countKeyEvents(events)
    },
    download(filename) {
      // Stopping first is not tidiness: rrweb buffers mutations, and a file written while recording is
      // missing its own final seconds — exactly the part being investigated.
      handle.stop()

      const first = events[0]
      const last = events[events.length - 1]
      const startedAt = first?.timestamp ?? Date.now()

      const payload: RecordingFile = {
        id: label,
        label,
        events,
        startedAt,
        durationMs: (last?.timestamp ?? startedAt) - startedAt,
        meta: {
          // rrweb records this nowhere, so the wrapper is the only place it can come from.
          userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        },
      }

      downloadRecording(payload, filename ?? label)
    },
  }

  active = { handle, label }
  return handle
}

/**
 * Turns the recorded events into a downloadable file.
 *
 * Kept separate from `startRecording` so it can be called from a button handler, and so the filename
 * convention lives in one place: `<bug>.session.json`, matching the slugs in bugs.ts and the sample
 * recordings in `traces/public/recordings/`.
 */
export function downloadRecording(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.session.json') ? filename : `${filename}.session.json`
  anchor.click()

  // Revoking immediately cancels the download in Safari; one frame is enough everywhere.
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

/** Re-exported so the TODO above and the call site can't drift on the option name. */
export const RRWEB_CHECKOUT_INTERVAL_MS = 5000

/** Counts of the event kinds worth checking before calling a recording usable. See README.md. */
export function countKeyEvents(events: RecordedEvent[]): RecordingSummary {
  const first = events[0]
  const last = events[events.length - 1]

  return {
    total: events.length,
    fullSnapshots: events.filter((event) => event.type === EVENT_TYPE_FULL_SNAPSHOT).length,
    metaEvents: events.filter((event) => event.type === EVENT_TYPE_META).length,
    durationMs: first && last ? last.timestamp - first.timestamp : 0,
  }
}

export { record }
