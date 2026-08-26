import type { BisectResult } from '@/types/domain'

/** Default precision. Fine enough to name a moment, coarse enough to finish in about six probes. */
export const DEFAULT_PRECISION_MS = 250

/**
 * One probe of the search: position the replay at `atMs` and evaluate the predicate there.
 *
 * Injected rather than imported, which is what keeps this file pure: `bisect.test.ts` passes a fake
 * probe with a known transition point and tests the search logic in milliseconds, with no rrweb, no
 * iframe and no timing. The off-by-one that would otherwise ship — a confidently wrong timestamp —
 * is exactly the class of bug that only unit tests catch.
 */
export type BisectProbe = (atMs: number) => Promise<{ result: boolean; elementMissing: boolean }>

export type BisectOptions = {
  from: number
  to: number
  precisionMs?: number
  probe: BisectProbe
  /** Injectable clock, so elapsedMs is testable. Defaults to Date.now. */
  now?: () => number
}

/**
 * Binary-search the replay timeline for the first moment a predicate holds.
 *
 * Owner: Riko. Contract: docs/tools.md#4-bisect.
 *
 * This is the idea the project is built on. The agent doesn't fetch a value; it sends a predicate and
 * the page runs a search, replaying to a different point in time on each iteration. Six probes over a
 * 47-second recording locates a state change to within 250 ms — and because each probe restarts from
 * the nearest checkpoint rather than from zero, it takes about a second rather than about ten.
 *
 * The predicate is assumed monotonic: false, then true, and not back again. That assumption is the
 * reason the two flags below exist, and both matter more than they look:
 *
 *   - already true at `from` → `{ firstTrue: from, alreadyTrueAtStart: true }`. Without the flag the
 *     agent reports the start of its search window as the moment the bug appeared, which is a
 *     plausible sentence about the wrong instant.
 *   - never true in `[from, to]` → `{ firstTrue: null }`. Not an error: "this never happened" is a
 *     useful answer and the agent should be able to act on it rather than retry.
 *
 * TODO(riko), Day 2. Write bisect.test.ts first; the cases are already listed there.
 *   - probe `from` before searching, to settle alreadyTrueAtStart
 *   - probe `to`; if false there, return firstTrue: null without searching further
 *   - then the loop: while (to - from) > precisionMs, probe the midpoint, keep the half containing
 *     the transition, and push every probe onto `trace` in the order it ran — BisectTrace animates
 *     that array, so its order is a UI contract as much as a data one
 *   - carry elementMissing through: false-because-absent is not false-because-enabled
 */
export async function bisect(_options: BisectOptions): Promise<BisectResult> {
  throw new Error('bisect: not implemented')
}
