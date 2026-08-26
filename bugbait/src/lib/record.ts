'use client'

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

export type RecorderHandle = {
  stop: () => void
  eventCount: () => number
  /** Triggers a browser download of the recording as JSON. */
  download: (filename?: string) => void
}

/**
 * TODO(vicko), Day 5:
 *   - `record({ emit, maskAllInputs: true, recordCanvas: false, collectFonts: false,
 *     checkoutEveryNms: 5000 })`
 *   - `checkoutEveryNms` is the load-bearing option: it forces periodic full snapshots, which is what
 *     `checkpoint-index.ts` indexes and what makes each bisect probe cost ~1s instead of ~10s. Without
 *     it, bisect technically works and is too slow to demo. Verify a recording actually contains
 *     multiple type-2 events before calling this done
 *   - keep events in a plain array; do not stream or compress. A 47s recording is a few MB of JSON and
 *     `loadRecording` expects the raw array
 *   - download as `{ id, label, events, startedAt, durationMs, meta }` matching Traces's Recording
 *     shape, so loading is a parse and not a migration
 *   - stop the recorder before downloading, or the last events are missing from the file
 */
export function startRecording(_label: string): RecorderHandle {
  throw new Error('startRecording: not implemented')
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

export { record }
