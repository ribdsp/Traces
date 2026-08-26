import type { Recording, RecordingMeta, RrwebEvent } from '@/types/domain'
import {
  collectNavigations,
  isClickEvent,
  isConsoleEvent,
  isFullSnapshotEvent,
  isInputEvent,
  isMetaEvent,
  isNetworkFailureEvent,
} from './rrweb-events'

/**
 * Validate one array element as a structurally-minimal rrweb event (see `RrwebEvent` in
 * types/domain.ts). Throws with the offending index so a malformed file names its own problem.
 */
function toRrwebEvent(candidate: unknown, index: number): RrwebEvent {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new Error(`Recording is invalid: event at index ${index} is not an object.`)
  }
  const record = candidate as Record<string, unknown>
  if (typeof record.type !== 'number') {
    throw new Error(`Recording is invalid: event at index ${index} is missing a numeric "type".`)
  }
  if (typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)) {
    throw new Error(`Recording is invalid: event at index ${index} is missing a numeric "timestamp".`)
  }
  return { type: record.type, timestamp: record.timestamp, data: record.data }
}

/**
 * Parse and validate a recording file.
 *
 * Owner: Riko.
 *
 * Validation is not ceremony here. A recording is untrusted input — see docs/threat-model.md (T6) —
 * and a truncated or hand-edited file that fails at load is a readable error, whereas the same file
 * failing on the fourth bisect probe looks like our binary search is broken.
 *
 * Rejects anything that isn't a non-empty array of events carrying at least `type` and `timestamp`,
 * requires at least one full snapshot (nothing is replayable without one), then normalises: sorts by
 * timestamp and derives `startedAt`/`durationMs` from the first and last event. `viewport` comes from
 * rrweb's own meta event rather than the browser at replay time, per RecordingMeta's contract.
 *
 * One deviation from a literal reading of that contract: rrweb's meta event is `{ href, width,
 * height }` — it has no `userAgent` field (confirmed against @rrweb/types; see rrweb-events.ts).
 * Treating a missing `userAgent` as a load failure would reject every ordinary rrweb recording, so it
 * is read opportunistically and falls back to `'unknown'`.
 */
export function loadRecording(id: string, label: string, raw: unknown): Recording {
  if (!Array.isArray(raw)) {
    throw new Error('Recording is invalid: expected a JSON array of rrweb events.')
  }
  if (raw.length === 0) {
    throw new Error('Recording is invalid: it contains no events.')
  }

  const events = raw.map(toRrwebEvent)
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)

  if (!sorted.some(isFullSnapshotEvent)) {
    throw new Error(
      'Recording is invalid: it has no full snapshot (event type 2), so there is nothing to replay.',
    )
  }

  const [first] = sorted
  const last = sorted[sorted.length - 1]
  if (first === undefined || last === undefined) {
    // Unreachable in practice: `raw.length === 0` was already rejected above, so `sorted` has the
    // same length as `raw`. Kept as a real check, not a non-null assertion, so this stays honest if
    // that invariant ever changes.
    throw new Error('Recording is invalid: it contains no events.')
  }
  const startedAt = first.timestamp
  const durationMs = last.timestamp - startedAt

  const metaEvents = sorted.filter(isMetaEvent)
  const firstMeta = metaEvents[0]?.data ?? null
  // Not `metaEvents.map(...)`: rrweb emits a Meta event at every checkout, so that reported a
  // navigation per checkpoint on a page that never navigated. See `collectNavigations`.
  const navigations = collectNavigations(sorted, startedAt)

  const meta: RecordingMeta = {
    recordingId: id,
    durationMs,
    eventCount: sorted.length,
    viewport: firstMeta ? { width: firstMeta.width, height: firstMeta.height } : { width: 0, height: 0 },
    userAgent: firstMeta?.userAgent ?? 'unknown',
    navigations,
    counts: {
      clicks: sorted.filter(isClickEvent).length,
      inputs: sorted.filter(isInputEvent).length,
      consoleErrors: sorted.filter(isConsoleEvent).filter((event) => event.data.level === 'error').length,
      failedRequests: sorted.filter(isNetworkFailureEvent).length,
    },
  }

  return { id, label, events: sorted, startedAt, durationMs, meta }
}

/**
 * Convert an absolute rrweb timestamp to recording-relative ms.
 *
 * Every time an agent ever sees is relative. Absolute epoch values leak the recording date into
 * tool responses, cost tokens, and are useless to a model.
 */
export function toRelativeMs(event: RrwebEvent, startedAt: number): number {
  return event.timestamp - startedAt
}
