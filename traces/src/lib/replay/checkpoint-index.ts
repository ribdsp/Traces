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
 * Returns the relative-ms position of every full snapshot, ascending.
 */
export function buildCheckpointIndex(events: RrwebEvent[], startedAt: number): number[] {
  return events
    .filter((event) => event.type === FULL_SNAPSHOT)
    .map((event) => event.timestamp - startedAt)
    .sort((a, b) => a - b)
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
