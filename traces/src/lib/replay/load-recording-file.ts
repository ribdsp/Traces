import type { Recording } from '@/types/domain'
import { loadRecording } from './load-recording'

/**
 * The on-disk recording file format, and the only place that knows it.
 *
 * A file in `traces/public/recordings/` is **not** a bare rrweb event array. It is the whole
 * `Recording` object, serialised:
 *
 * ```json
 * { "id": "empty-province", "label": "…", "events": [ … ], "startedAt": 1756…, "durationMs": 45118,
 *   "meta": { "userAgent": "…", "viewport": { "width": 1280, "height": 720 } } }
 * ```
 *
 * That is what `bugbait/src/lib/record.ts` downloads (`RecordingFile`), so it is what a contributor
 * regenerating a fixture produces, and it is what the three committed files contain. `loadRecording`,
 * meanwhile, takes the event array — so the pipeline was writing its own output at one end and unable
 * to read it back at the other, and no unit test caught it because every other test builds its input
 * in memory.
 *
 * Unwrapping lives here rather than inside `loadRecording` on purpose. `loadRecording` validates
 * untrusted input (docs/threat-model.md T6) and its strictness is the reason a truncated file fails
 * with a readable message instead of on the fourth bisect probe; widening it to also accept an object
 * would spend that. This function is the narrow adapter above it: it decides *where the events are*,
 * and delegates every question of whether they are valid.
 *
 * **Only `events` is read from the wrapper.** `startedAt`, `durationMs` and `meta` are recomputed by
 * `loadRecording` from the events, and the file's copies are ignored even though they are present.
 * Two reasons. Two sources of truth for a duration will eventually disagree, and the recorder writes
 * a deliberately partial `meta` — `{ userAgent, viewport }` and nothing else — so `eventCount`,
 * `navigations` and `counts` are all `undefined` on disk. Forwarding it would satisfy the type checker
 * and hand every downstream tool a `RecordingMeta` with holes in it. `id` and `label` come from the
 * caller (the picker's manifest), so the name a judge reads is the name that loads.
 */
export function loadRecordingFile(id: string, label: string, raw: unknown): Recording {
  return loadRecording(id, label, eventsIn(raw))
}

/**
 * Locate the event array in a parsed recording file.
 *
 * Anything unrecognised is returned untouched rather than rejected here, so the error the caller sees
 * is `loadRecording`'s — one voice for "this file is not a recording", named after the field it
 * actually checked.
 */
function eventsIn(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object' && raw !== null && 'events' in raw) {
    return (raw as { events: unknown }).events
  }
  return raw
}
