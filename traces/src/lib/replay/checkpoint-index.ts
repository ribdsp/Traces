import type { RrwebEvent } from '@/types/domain'

/** rrweb's EventType.FullSnapshot. Hardcoded so lib/ stays free of the rrweb dependency. */
const FULL_SNAPSHOT = 2

/**
 * Index the positions of full snapshots in a recording.
 *
 * Owner: Riko.
 *
 * This tiny file is what makes `bisect` fast enough to be a demo rather than a spinner. rrweb emits
 * a full snapshot periodically; replaying to time `t` from the nearest preceding snapshot costs a
 * fraction of replaying from zero. A bisect does ~6 probes, so the difference between "from the
 * nearest checkpoint" and "from the start" is the difference between about a second and about ten.
 *
 * TODO(riko), Day 2: return relative-ms positions of every type-2 event, ascending.
 */
export function buildCheckpointIndex(_events: RrwebEvent[], _startedAt: number): number[] {
  throw new Error('buildCheckpointIndex: not implemented')
}

/**
 * The latest checkpoint at or before `atMs`, or 0 when there is none before it.
 *
 * Assumes `checkpoints` is ascending, as `buildCheckpointIndex` returns it.
 */
export function nearestCheckpointBefore(checkpoints: number[], atMs: number): number {
  let best = 0
  for (const c of checkpoints) {
    if (c > atMs) break
    best = c
  }
  return best
}
