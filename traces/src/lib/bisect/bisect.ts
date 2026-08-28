import type { BisectResult, BisectStep } from '@/types/domain'

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
 * Safety net for the binary-search loop below. Never reached for a realistic `precisionMs`, since
 * the interval provably halves every pass — it only guards against pathological input like a
 * `precisionMs` of 0.
 */
const MAX_LOOP_ITERATIONS = 40

type ProbeOutcome = { atMs: number; result: boolean; elementMissing: boolean }

/**
 * Run one probe and append it to `trace` in call order. Every probe performed anywhere in this
 * file — the two boundary probes and every binary-search midpoint — goes through this one function,
 * which is what keeps `trace` a single, correctly-ordered record: `BisectTrace` animates that array,
 * so its order is a UI contract as much as a data one.
 */
async function recordProbe(probe: BisectProbe, atMs: number, trace: BisectStep[]): Promise<ProbeOutcome> {
  const { result, elementMissing } = await probe(atMs)
  trace.push({ atMs, result, elementMissing })
  return { atMs, result, elementMissing }
}

type BoundaryOutcome = { firstTrue: number | null; lastFalse: number | null; alreadyTrueAtStart?: boolean }

/**
 * Binary search for the transition, given the predicate is already known false at `low` and true at
 * `high` (both already probed and recorded by the caller). Halves the interval, keeping whichever
 * half still contains the transition, until the remaining width is within `precisionMs`.
 */
async function search(
  probe: BisectProbe,
  low: number,
  high: number,
  precisionMs: number,
  trace: BisectStep[],
): Promise<BoundaryOutcome> {
  let lowFalse = low
  let highTrue = high
  let loops = 0

  while (highTrue - lowFalse > precisionMs && loops < MAX_LOOP_ITERATIONS) {
    const mid = Math.floor((lowFalse + highTrue) / 2)
    const outcome = await recordProbe(probe, mid, trace)
    if (outcome.result) {
      highTrue = mid
    } else {
      lowFalse = mid
    }
    loops += 1
  }

  return { firstTrue: highTrue, lastFalse: lowFalse }
}

/**
 * Assemble the public result. `iterations` is defined as the total number of probes performed —
 * `trace.length`, boundary probes included — not just the binary-search loop count. That is the
 * number every case in bisect.test.ts actually cares about (the "not forty" ceiling, and "a coarser
 * precisionMs takes fewer iterations"): both read as "how many replays did this cost", which is what
 * this counts, and it needs no second definition for the early-exit branches that never reach the
 * loop at all.
 */
function finalize(
  outcome: BoundaryOutcome,
  trace: BisectStep[],
  precisionMs: number,
  startedAt: number,
  now: () => number,
): BisectResult {
  return {
    firstTrue: outcome.firstTrue,
    lastFalse: outcome.lastFalse,
    iterations: trace.length,
    elapsedMs: now() - startedAt,
    precisionMs,
    ...(outcome.alreadyTrueAtStart ? { alreadyTrueAtStart: true as const } : {}),
    trace,
  }
}

/**
 * Binary-search the replay timeline for the first moment a predicate holds.
 *
 * Contract: docs/tools.md#4-bisect.
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
 * Shape of the search: probe `from` first (settles `alreadyTrueAtStart`), then probe `to` — if it's
 * false there, the predicate never held in this window and the search stops at two probes. Otherwise,
 * if `from` was already true, the search stops there too: there's no transition to locate inside the
 * window, only a floor. Only when `from` is false and `to` is true does the actual binary search run.
 * A zero-width window (`from === to`) is handled before any of this, with a single probe, so it can't
 * loop.
 *
 * `now()` is read exactly twice: once before the first probe, once after the last one. `elapsedMs` is
 * their difference — reading it per-probe would double-count the very cost this is meant to measure.
 */
export async function bisect(options: BisectOptions): Promise<BisectResult> {
  const precisionMs = options.precisionMs ?? DEFAULT_PRECISION_MS
  const now = options.now ?? Date.now
  const trace: BisectStep[] = []
  const startedAt = now()

  if (options.from === options.to) {
    const at = await recordProbe(options.probe, options.from, trace)
    const outcome: BoundaryOutcome = at.result
      ? { firstTrue: options.from, lastFalse: null, alreadyTrueAtStart: true }
      : { firstTrue: null, lastFalse: options.from }
    return finalize(outcome, trace, precisionMs, startedAt, now)
  }

  const atFrom = await recordProbe(options.probe, options.from, trace)
  const atTo = await recordProbe(options.probe, options.to, trace)

  if (!atTo.result) {
    // Never true anywhere in the window. `to` is the point we actually probed and confirmed false.
    return finalize({ firstTrue: null, lastFalse: options.to }, trace, precisionMs, startedAt, now)
  }

  if (atFrom.result) {
    // Already true at the start: firstTrue is a floor, not an observed transition, so lastFalse is
    // null — we never saw it false anywhere in this window.
    const outcome: BoundaryOutcome = { firstTrue: options.from, lastFalse: null, alreadyTrueAtStart: true }
    return finalize(outcome, trace, precisionMs, startedAt, now)
  }

  const outcome = await search(options.probe, options.from, options.to, precisionMs, trace)
  return finalize(outcome, trace, precisionMs, startedAt, now)
}
