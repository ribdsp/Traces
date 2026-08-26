import type { DigestEvent, Recording } from '@/types/domain'

/** `list_events` never returns more than this. A longer list teaches an agent less, not more. */
export const DIGEST_LIMIT = 40

export type DigestOptions = {
  fromMs?: number
  toMs?: number
  kinds?: DigestEvent['kind'][]
  limit?: number
}

/**
 * Reduce thousands of rrweb events to the short list worth an agent's attention.
 *
 * Owner: Riko.
 *
 * TODO(riko), Day 3:
 *   - keep clicks, inputs (value redacted — length only, see docs/threat-model.md), navigations,
 *     console errors and warnings, failed requests
 *   - collapse three or more clicks on the same selector within 1s into one `rageClick`; that
 *     pattern is usually the single most informative line in the whole digest
 *   - drop everything else: mouse movement, scroll, and plain mutations are noise at this level
 *   - on truncation, keep the *earliest* events and say so — an agent reasoning about a first
 *     occurrence needs the start of the window, not a random slice of it
 */
export function buildEventDigest(
  _recording: Recording,
  _options: DigestOptions = {},
): { events: DigestEvent[]; truncated: boolean } {
  throw new Error('buildEventDigest: not implemented')
}
