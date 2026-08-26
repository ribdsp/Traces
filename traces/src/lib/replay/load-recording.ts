import type { Recording, RrwebEvent } from '@/types/domain'

/**
 * Parse and validate a recording file.
 *
 * Owner: Riko.
 *
 * Validation is not ceremony here. A recording is untrusted input — see docs/threat-model.md (T6) —
 * and a truncated or hand-edited file that fails at load is a readable error, whereas the same file
 * failing on the fourth bisect probe looks like our binary search is broken.
 *
 * TODO(riko), Day 2:
 *   - reject non-arrays, empty arrays, events missing `type` or a numeric `timestamp`
 *   - require at least one full snapshot (type 2), otherwise nothing can be replayed
 *   - normalise: sort by timestamp, derive startedAt/durationMs from first and last event
 *   - pull `viewport` and `userAgent` out of the rrweb meta event rather than sniffing at replay time
 */
export function loadRecording(_id: string, _label: string, _raw: unknown): Recording {
  throw new Error('loadRecording: not implemented')
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
