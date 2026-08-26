import { describe, expect, it } from 'vitest'
import { buildCheckpointIndex, nearestCheckpointBefore } from './checkpoint-index'

function fullSnapshot(timestamp: number) {
  return { type: 2, timestamp, data: {} }
}

function incrementalSnapshot(timestamp: number) {
  return { type: 3, timestamp, data: {} }
}

describe('buildCheckpointIndex', () => {
  it('returns the relative-ms position of every full snapshot', () => {
    const startedAt = 1_000
    const events = [fullSnapshot(1_000), incrementalSnapshot(1_200), fullSnapshot(6_000)]

    expect(buildCheckpointIndex(events, startedAt)).toEqual([0, 5_000])
  })

  it('ignores events that are not full snapshots', () => {
    const startedAt = 0
    const events = [incrementalSnapshot(10), incrementalSnapshot(20), incrementalSnapshot(30)]

    expect(buildCheckpointIndex(events, startedAt)).toEqual([])
  })

  it('returns positions ascending even when the input events are not in order', () => {
    const startedAt = 0
    const events = [fullSnapshot(9_000), fullSnapshot(1_000), fullSnapshot(5_000)]

    expect(buildCheckpointIndex(events, startedAt)).toEqual([1_000, 5_000, 9_000])
  })

  it('returns an empty array for a recording with no full snapshot', () => {
    expect(buildCheckpointIndex([], 0)).toEqual([])
  })
})

describe('nearestCheckpointBefore', () => {
  it('returns the latest checkpoint at or before the given time', () => {
    const checkpoints = [0, 5_000, 10_000]

    expect(nearestCheckpointBefore(checkpoints, 7_500)).toBe(5_000)
  })

  it('returns 0 when there is no checkpoint before the given time', () => {
    expect(nearestCheckpointBefore([], 7_500)).toBe(0)
  })
})
