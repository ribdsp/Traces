import { describe, expect, it } from 'vitest'
import type { RrwebEvent } from '@/types/domain'
import { loadRecordingFile } from './load-recording-file'

/**
 * Unit-level cover for the adapter. The companion `*.recordings.test.ts` runs the real files through
 * it; this file pins the shapes those three happen not to exercise — a bare array, a wrapper whose
 * precomputed fields disagree with its events, and the error messages for input that is neither.
 */

const FULL_SNAPSHOT = 2
const META = 4

function events(): RrwebEvent[] {
  return [
    { type: META, timestamp: 1000, data: { href: 'http://localhost/cart', width: 1280, height: 720 } },
    { type: FULL_SNAPSHOT, timestamp: 1000, data: {} },
    { type: 3, timestamp: 4000, data: { source: 2, type: 2, id: 7 } },
  ]
}

describe('loadRecordingFile', () => {
  it('accepts the wrapper written by the recorder', () => {
    const recording = loadRecordingFile('slug', 'Label', {
      id: 'ignored',
      label: 'ignored',
      events: events(),
      startedAt: 1000,
      durationMs: 3000,
      meta: { userAgent: 'test-agent', viewport: { width: 1280, height: 720 } },
    })

    expect(recording.events).toHaveLength(3)
    expect(recording.durationMs).toBe(3000)
  })

  it('accepts a bare event array, so a hand-extracted array still loads', () => {
    const recording = loadRecordingFile('slug', 'Label', events())

    expect(recording.events).toHaveLength(3)
    expect(recording.durationMs).toBe(3000)
  })

  it('takes id and label from the caller, not from the file', () => {
    const recording = loadRecordingFile('slug', 'Label', {
      id: 'stale-id',
      label: 'Stale label',
      events: events(),
    })

    expect(recording.id).toBe('slug')
    expect(recording.label).toBe('Label')
    expect(recording.meta.recordingId).toBe('slug')
  })

  it('recomputes duration rather than trusting the wrapper', () => {
    const recording = loadRecordingFile('slug', 'Label', {
      events: events(),
      startedAt: 999_999,
      durationMs: 60_000,
    })

    expect(recording.startedAt).toBe(1000)
    expect(recording.durationMs).toBe(3000)
    expect(recording.meta.durationMs).toBe(3000)
  })

  it('recomputes meta rather than forwarding the recorder partial one', () => {
    // The recorder writes only `userAgent` and `viewport`. Forwarding that object would leave
    // `eventCount`, `navigations` and `counts` undefined behind a satisfied type.
    const recording = loadRecordingFile('slug', 'Label', {
      events: events(),
      meta: { userAgent: 'wrapper-agent', viewport: { width: 1, height: 1 } },
    })

    expect(recording.meta.eventCount).toBe(3)
    expect(recording.meta.navigations).toHaveLength(1)
    expect(recording.meta.counts).toEqual({ clicks: 1, inputs: 0, consoleErrors: 0, failedRequests: 0 })
    // From rrweb's own meta event, per RecordingMeta's contract — not the wrapper's 1x1.
    expect(recording.meta.viewport).toEqual({ width: 1280, height: 720 })
  })

  it('rejects a wrapper whose events are not an array', () => {
    expect(() => loadRecordingFile('slug', 'Label', { events: 'nope' })).toThrow(
      /expected a JSON array of rrweb events/,
    )
  })

  it('rejects an object that is not a recording at all', () => {
    expect(() => loadRecordingFile('slug', 'Label', { foo: 1 })).toThrow(
      /expected a JSON array of rrweb events/,
    )
  })

  it('rejects an empty wrapper', () => {
    expect(() => loadRecordingFile('slug', 'Label', { events: [] })).toThrow(/contains no events/)
  })

  it('still requires a full snapshot', () => {
    const withoutSnapshot = events().filter((event) => event.type !== FULL_SNAPSHOT)

    expect(() => loadRecordingFile('slug', 'Label', { events: withoutSnapshot })).toThrow(
      /no full snapshot/,
    )
  })
})
