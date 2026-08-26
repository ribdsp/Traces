import { describe, expect, it } from 'vitest'
import type { Recording, RecordingMeta } from '@/types/domain'
import { buildEventDigest, DIGEST_LIMIT } from './event-digest'

function clickEvent(timestamp: number, nodeId: number) {
  return { type: 3, timestamp, data: { source: 2, type: 2, id: nodeId } }
}

function mouseMoveEvent(timestamp: number) {
  return { type: 3, timestamp, data: { source: 1, positions: [] } }
}

function scrollEvent(timestamp: number) {
  return { type: 3, timestamp, data: { source: 3, id: 1, x: 0, y: 10 } }
}

function mutationEvent(timestamp: number) {
  return { type: 3, timestamp, data: { source: 0, texts: [], attributes: [], removes: [], adds: [] } }
}

function inputEvent(timestamp: number, nodeId: number, text: string) {
  return { type: 3, timestamp, data: { source: 5, id: nodeId, text, isChecked: false } }
}

function metaEvent(timestamp: number, href: string) {
  return { type: 4, timestamp, data: { href, width: 1280, height: 720 } }
}

function consoleEvent(timestamp: number, level: 'error' | 'warn' | 'log', payload: unknown[]) {
  return { type: 3, timestamp, data: { source: 11, level, payload } }
}

function networkFailureEvent(timestamp: number, url: string, status: number) {
  return { type: 5, timestamp, data: { tag: 'network-request', payload: { url, status, ok: false } } }
}

const emptyMeta: RecordingMeta = {
  recordingId: 'rec-1',
  durationMs: 0,
  eventCount: 0,
  viewport: { width: 1280, height: 720 },
  userAgent: 'unknown',
  navigations: [],
  counts: { clicks: 0, inputs: 0, consoleErrors: 0, failedRequests: 0 },
}

function buildRecording(events: Recording['events'], durationMs = 10_000): Recording {
  return {
    id: 'rec-1',
    label: 'Fixture',
    events,
    startedAt: 0,
    durationMs,
    meta: { ...emptyMeta, durationMs, eventCount: events.length },
  }
}

describe('buildEventDigest', () => {
  it('keeps an ordinary click as a digest event', () => {
    const recording = buildRecording([clickEvent(100, 1)])

    const { events } = buildEventDigest(recording)

    expect(events).toEqual([expect.objectContaining({ atMs: 100, kind: 'click' })])
  })

  it('collapses three or more clicks on the same node within the rage-click window into one rageClick', () => {
    const recording = buildRecording([clickEvent(0, 1), clickEvent(300, 1), clickEvent(600, 1)])

    const { events } = buildEventDigest(recording)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ atMs: 0, kind: 'rageClick' })
  })

  it('does not collapse two clicks on the same node, since that is below the rage-click threshold', () => {
    const recording = buildRecording([clickEvent(0, 1), clickEvent(300, 1)])

    const { events } = buildEventDigest(recording)

    expect(events.map((event) => event.kind)).toEqual(['click', 'click'])
  })

  it('does not collapse clicks on different nodes even when they are close in time', () => {
    const recording = buildRecording([clickEvent(0, 1), clickEvent(100, 2), clickEvent(200, 3)])

    const { events } = buildEventDigest(recording)

    expect(events.map((event) => event.kind)).toEqual(['click', 'click', 'click'])
  })

  it('does not collapse clicks on the same node when the gap between them exceeds the rage-click window', () => {
    const recording = buildRecording([clickEvent(0, 1), clickEvent(1_500, 1), clickEvent(3_000, 1)])

    const { events } = buildEventDigest(recording)

    expect(events.map((event) => event.kind)).toEqual(['click', 'click', 'click'])
  })

  it('keeps an input event without ever echoing its value, only its length', () => {
    const recording = buildRecording([inputEvent(50, 1, 'super-secret-value')])

    const { events } = buildEventDigest(recording)

    expect(events).toHaveLength(1)
    const [first] = events
    expect(first?.kind).toBe('input')
    expect(JSON.stringify(first)).not.toContain('super-secret-value')
    expect(first?.summary).toContain('18')
  })

  it('keeps a navigation event derived from the meta event', () => {
    const recording = buildRecording([metaEvent(0, 'https://example.test/next')])

    const { events } = buildEventDigest(recording)

    expect(events).toEqual([expect.objectContaining({ atMs: 0, kind: 'navigation' })])
  })

  // The digest's scarcest resource is its own line count, and a checkout meta event costs a line while
  // saying nothing: rrweb emits one per checkout, not one per navigation (measured — see
  // `collectNavigations`). Four of them restating one url used to crowd out the console error that is
  // the actual reason anyone opened the recording.
  it('collapses repeated checkout meta events into one navigation and keeps the real events', () => {
    const recording = buildRecording([
      metaEvent(0, 'https://example.test/checkout'),
      metaEvent(1084, 'https://example.test/checkout'),
      consoleEvent(1500, 'error', ['province list failed to load']),
      metaEvent(2393, 'https://example.test/checkout'),
      metaEvent(3518, 'https://example.test/checkout'),
    ])

    const { events } = buildEventDigest(recording)

    expect(events).toEqual([
      expect.objectContaining({ atMs: 0, kind: 'navigation' }),
      expect.objectContaining({ atMs: 1500, kind: 'consoleError' }),
    ])
  })

  it('keeps console errors and warnings but drops plain console.log calls', () => {
    const recording = buildRecording([
      consoleEvent(10, 'error', ['boom']),
      consoleEvent(20, 'warn', ['careful']),
      consoleEvent(30, 'log', ['just chatting']),
    ])

    const { events } = buildEventDigest(recording)

    expect(events.map((event) => event.kind)).toEqual(['consoleError', 'consoleWarn'])
  })

  it('keeps a failed request event', () => {
    const recording = buildRecording([networkFailureEvent(10, 'https://example.test/api', 500)])

    const { events } = buildEventDigest(recording)

    expect(events).toEqual([expect.objectContaining({ atMs: 10, kind: 'failedRequest' })])
    expect(events[0]?.summary).toContain('500')
  })

  it('drops mouse movement, scroll, and plain mutation events as noise', () => {
    const recording = buildRecording([mouseMoveEvent(10), scrollEvent(20), mutationEvent(30)])

    const { events } = buildEventDigest(recording)

    expect(events).toEqual([])
  })

  it('honours fromMs/toMs and excludes events outside the window', () => {
    const recording = buildRecording([clickEvent(0, 1), clickEvent(500, 2), clickEvent(1_000, 3)])

    const { events } = buildEventDigest(recording, { fromMs: 250, toMs: 750 })

    expect(events).toEqual([expect.objectContaining({ atMs: 500 })])
  })

  it('honours the kinds filter', () => {
    const recording = buildRecording([clickEvent(0, 1), inputEvent(10, 2, 'x')])

    const { events } = buildEventDigest(recording, { kinds: ['input'] })

    expect(events.map((event) => event.kind)).toEqual(['input'])
  })

  it('truncates to the limit, keeping the earliest events, and reports truncated: true', () => {
    const events = Array.from({ length: 5 }, (_, index) => clickEvent(index * 1_000, index + 1))
    const recording = buildRecording(events, 10_000)

    const result = buildEventDigest(recording, { limit: 2 })

    expect(result.truncated).toBe(true)
    expect(result.events).toHaveLength(2)
    expect(result.events.map((event) => event.atMs)).toEqual([0, 1_000])
  })

  it('defaults the limit to DIGEST_LIMIT and reports truncated: false when under it', () => {
    const recording = buildRecording([clickEvent(0, 1)])

    const result = buildEventDigest(recording)

    expect(result.truncated).toBe(false)
    expect(DIGEST_LIMIT).toBe(40)
  })

  it('returns events sorted by time even when the underlying events are out of order', () => {
    const recording = buildRecording([clickEvent(500, 1), metaEvent(0, 'https://example.test/')])

    const { events } = buildEventDigest(recording)

    expect(events.map((event) => event.atMs)).toEqual([0, 500])
  })
})
