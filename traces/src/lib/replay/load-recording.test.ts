import { describe, expect, it } from 'vitest'
import { loadRecording, toRelativeMs } from './load-recording'

// Fixture builders below produce the plain JSON shape rrweb actually emits on the wire — not rrweb
// objects — since load-recording.ts (like the rest of lib/replay) never imports the rrweb package.

function fullSnapshot(timestamp: number) {
  return { type: 2, timestamp, data: { node: {}, initialOffset: { top: 0, left: 0 } } }
}

function metaEvent(
  timestamp: number,
  href: string,
  options: { width?: number; height?: number; userAgent?: string } = {},
) {
  const { width = 1280, height = 720, userAgent } = options
  return { type: 4, timestamp, data: { href, width, height, ...(userAgent ? { userAgent } : {}) } }
}

function clickEvent(timestamp: number, nodeId: number) {
  return { type: 3, timestamp, data: { source: 2, type: 2, id: nodeId } }
}

function inputEvent(timestamp: number, nodeId: number, text: string) {
  return { type: 3, timestamp, data: { source: 5, id: nodeId, text, isChecked: false } }
}

function consoleEvent(timestamp: number, level: 'error' | 'warn' | 'log', payload: string[]) {
  return { type: 3, timestamp, data: { source: 11, level, payload } }
}

function networkFailureEvent(timestamp: number, url: string, status: number) {
  return { type: 5, timestamp, data: { tag: 'network-request', payload: { url, status, ok: false } } }
}

describe('loadRecording', () => {
  it('rejects a recording that is not an array', () => {
    expect(() => loadRecording('rec-1', 'Bad shape', { not: 'an array' })).toThrow(/array/i)
  })

  it('rejects an empty array', () => {
    expect(() => loadRecording('rec-1', 'Empty', [])).toThrow(/no events/i)
  })

  it('rejects an event missing a numeric "type"', () => {
    const raw = [{ timestamp: 0, data: {} }, fullSnapshot(10)]
    expect(() => loadRecording('rec-1', 'Missing type', raw)).toThrow(/index 0/)
  })

  it('rejects an event missing a numeric "timestamp"', () => {
    const raw = [{ type: 2, data: {} }]
    expect(() => loadRecording('rec-1', 'Missing timestamp', raw)).toThrow(/index 0/)
  })

  it('rejects a recording with no full snapshot', () => {
    const raw = [metaEvent(0, 'https://example.test/'), clickEvent(50, 7)]
    expect(() => loadRecording('rec-1', 'No snapshot', raw)).toThrow(/full snapshot/i)
  })

  it('sorts events by timestamp and derives startedAt/durationMs from the sorted ends', () => {
    const raw = [clickEvent(300, 1), fullSnapshot(100), metaEvent(100, 'https://example.test/')]

    const recording = loadRecording('rec-1', 'Out of order', raw)

    expect(recording.events.map((event) => event.timestamp)).toEqual([100, 100, 300])
    expect(recording.startedAt).toBe(100)
    expect(recording.durationMs).toBe(200)
  })

  it('reads viewport and userAgent from the rrweb meta event when present', () => {
    const raw = [
      fullSnapshot(0),
      metaEvent(0, 'https://example.test/', { width: 1024, height: 768, userAgent: 'test-agent/1.0' }),
    ]

    const { meta } = loadRecording('rec-1', 'With meta', raw)

    expect(meta.viewport).toEqual({ width: 1024, height: 768 })
    expect(meta.userAgent).toBe('test-agent/1.0')
  })

  it('falls back to "unknown" userAgent when the meta event has none, since rrweb never sends one', () => {
    const raw = [fullSnapshot(0), metaEvent(0, 'https://example.test/')]

    const { meta } = loadRecording('rec-1', 'No user agent', raw)

    expect(meta.userAgent).toBe('unknown')
  })

  it('builds a navigation per url change, in order, relative to startedAt', () => {
    const raw = [
      fullSnapshot(0),
      metaEvent(0, 'https://example.test/'),
      metaEvent(500, 'https://example.test/next'),
    ]

    const { meta } = loadRecording('rec-1', 'Navigations', raw)

    expect(meta.navigations).toEqual([
      { atMs: 0, url: 'https://example.test/' },
      { atMs: 500, url: 'https://example.test/next' },
    ])
  })

  // The fixture below is the shape a *real* recording has and the shape a hand-written one never has.
  // rrweb emits a Meta event alongside every checkout FullSnapshot, so `checkoutEveryNms: 1000` on a
  // page that never navigates still produces a Meta per second. Measured: four, at 0/1084/2393/3518 ms,
  // identical href. Mapping Meta one-to-one onto navigations reported four navigations for zero — and
  // because buildReport trusts digest-derived steps as `verified: true`, that reached a bug report as
  // "Navigated to /checkout", four times, about a session with no navigation in it. Every test in this
  // file passed throughout. See `collectNavigations` in rrweb-events.ts.
  it('reports one navigation when repeated checkout meta events all carry the same url', () => {
    const raw = [
      metaEvent(0, 'https://example.test/checkout'),
      fullSnapshot(0),
      metaEvent(1084, 'https://example.test/checkout'),
      fullSnapshot(1084),
      metaEvent(2393, 'https://example.test/checkout'),
      fullSnapshot(2393),
      metaEvent(3518, 'https://example.test/checkout'),
      fullSnapshot(3518),
    ]

    const { meta } = loadRecording('rec-1', 'Four checkouts, no navigation', raw)

    expect(meta.navigations).toEqual([{ atMs: 0, url: 'https://example.test/checkout' }])
  })

  // Consecutive-only deduplication, pinned deliberately: a `Set` of seen urls would also collapse the
  // fixture above, and would then swallow the second visit here. Returning to a page is a navigation.
  it('reports a return to an earlier url as its own navigation', () => {
    const raw = [
      fullSnapshot(0),
      metaEvent(0, 'https://example.test/cart'),
      metaEvent(500, 'https://example.test/checkout'),
      metaEvent(900, 'https://example.test/cart'),
    ]

    const { meta } = loadRecording('rec-1', 'There and back', raw)

    expect(meta.navigations).toEqual([
      { atMs: 0, url: 'https://example.test/cart' },
      { atMs: 500, url: 'https://example.test/checkout' },
      { atMs: 900, url: 'https://example.test/cart' },
    ])
  })

  it('counts clicks, inputs, console errors, and failed requests', () => {
    const raw = [
      fullSnapshot(0),
      metaEvent(0, 'https://example.test/'),
      clickEvent(10, 1),
      clickEvent(20, 2),
      inputEvent(30, 3, 'hello'),
      consoleEvent(40, 'error', ['boom']),
      consoleEvent(45, 'log', ['ignored, not an error or a warning']),
      networkFailureEvent(50, 'https://example.test/api', 500),
    ]

    const { meta } = loadRecording('rec-1', 'Counts', raw)

    expect(meta.counts).toEqual({ clicks: 2, inputs: 1, consoleErrors: 1, failedRequests: 1 })
  })

  it('never echoes an input value into the loaded recording, only its length via counts', () => {
    const raw = [fullSnapshot(0), inputEvent(10, 1, 'super-secret-value')]

    const recording = loadRecording('rec-1', 'Redaction', raw)

    expect(JSON.stringify(recording.meta)).not.toContain('super-secret-value')
  })

  it('carries the given id and label through unchanged', () => {
    const raw = [fullSnapshot(0)]

    const recording = loadRecording('rec-42', 'My Recording', raw)

    expect(recording.id).toBe('rec-42')
    expect(recording.label).toBe('My Recording')
  })
})

describe('toRelativeMs', () => {
  it('subtracts startedAt from the event timestamp', () => {
    const event = { type: 3, timestamp: 1_500, data: {} }

    expect(toRelativeMs(event, 1_000)).toBe(500)
  })
})
