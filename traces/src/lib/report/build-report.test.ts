import { describe, expect, it } from 'vitest'
import type { Recording, RecordingMeta, Report } from '@/types/domain'
import { buildReport, MATCH_WINDOW_MS } from './build-report'

// Raw rrweb event builders, mirroring lib/replay/event-digest.test.ts's conventions so a fixture here
// reads the same way it would there.

function clickEvent(timestamp: number, nodeId: number) {
  return { type: 3, timestamp, data: { source: 2, type: 2, id: nodeId } }
}

function inputEvent(timestamp: number, nodeId: number, text: string) {
  return { type: 3, timestamp, data: { source: 5, id: nodeId, text, isChecked: false } }
}

function metaEvent(timestamp: number, href: string) {
  return { type: 4, timestamp, data: { href, width: 1280, height: 720 } }
}

function consoleErrorEvent(timestamp: number, message: string) {
  return { type: 3, timestamp, data: { source: 11, level: 'error', payload: [message] } }
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

describe('buildReport', () => {
  it('marks a proposed step with no supporting event as verified: false, and keeps it', () => {
    const recording = buildRecording([clickEvent(100, 1)])
    const proposed: Partial<Report> = { steps: [{ text: 'User submits the form', atMs: 9_000, verified: true }] }

    const result = buildReport(recording, proposed)

    expect(result.steps).toEqual([{ text: 'User submits the form', verified: false }])
  })

  it('never drops an unsupported step: a proposal with no atMs at all also survives as verified: false', () => {
    const recording = buildRecording([clickEvent(100, 1)])
    const proposed: Partial<Report> = { steps: [{ text: 'User does something', verified: true }] }

    const result = buildReport(recording, proposed)

    expect(result.steps).toEqual([{ text: 'User does something', verified: false }])
  })

  it('never silently promotes a step: it ignores the caller-supplied verified flag and recomputes it', () => {
    const recording = buildRecording([clickEvent(100, 1)])
    const claimedTrue: Partial<Report> = { steps: [{ text: 'Unsupported claim', atMs: 9_000, verified: true }] }
    const claimedFalse: Partial<Report> = { steps: [{ text: 'Unsupported claim', atMs: 9_000, verified: false }] }

    expect(buildReport(recording, claimedTrue).steps[0]?.verified).toBe(false)
    expect(buildReport(recording, claimedFalse).steps[0]?.verified).toBe(false)
  })

  it('marks a proposed step verified: true, with atMs taken from the matched event, when a step-worthy event supports it', () => {
    const recording = buildRecording([clickEvent(5_000, 1)])
    const proposed: Partial<Report> = { steps: [{ text: 'User clicks submit', atMs: 5_040, verified: false }] }

    const result = buildReport(recording, proposed)

    expect(result.steps).toEqual([{ text: 'User clicks submit', atMs: 5_000, verified: true }])
  })

  it('matches at exactly MATCH_WINDOW_MS away, and fails just beyond it', () => {
    const recording = buildRecording([clickEvent(0, 1)])
    const atBoundary: Partial<Report> = { steps: [{ text: 'On the edge', atMs: MATCH_WINDOW_MS, verified: false }] }
    const pastBoundary: Partial<Report> = {
      steps: [{ text: 'Just past the edge', atMs: MATCH_WINDOW_MS + 1, verified: false }],
    }

    expect(buildReport(recording, atBoundary).steps[0]).toMatchObject({ verified: true, atMs: 0 })
    expect(buildReport(recording, pastBoundary).steps[0]).toMatchObject({ verified: false })
  })

  // Measured against a real 3598ms rrweb recording, before this was guarded: a proposed step reading
  // "Click the pay button" at 5000ms came back verified, with its atMs rewritten to 3596. The recording
  // is 3598ms long and contains no clicks at all. MATCH_WINDOW_MS reaches 2 seconds in both directions
  // and does not stop at the end of the recording, so any fabricated timestamp within 2s of the end
  // borrowed the last real event's credibility.
  it('refuses to verify a step claiming a moment after the recording ends', () => {
    const recording = buildRecording([inputEvent(3_596, 1, 'ab')], 3_598)
    const proposed: Partial<Report> = { steps: [{ text: 'Click the pay button', atMs: 5_000, verified: false }] }

    const result = buildReport(recording, proposed)

    expect(result.steps).toEqual([{ text: 'Click the pay button', verified: false }])
  })

  it('refuses to verify a step claiming a moment before the recording starts', () => {
    const recording = buildRecording([clickEvent(100, 1)], 3_598)
    const proposed: Partial<Report> = { steps: [{ text: 'Open the app', atMs: -500, verified: false }] }

    expect(buildReport(recording, proposed).steps[0]).toEqual({ text: 'Open the app', verified: false })
  })

  it('still verifies a step at the very last millisecond of the recording', () => {
    const recording = buildRecording([inputEvent(3_596, 1, 'ab')], 3_598)
    const proposed: Partial<Report> = { steps: [{ text: 'Tick the save box', atMs: 3_598, verified: false }] }

    expect(buildReport(recording, proposed).steps[0]).toMatchObject({ verified: true, atMs: 3_596 })
  })

  it('never echoes a typed input value into the report when reconciling a proposed step against it', () => {
    const secret = 'super-secret-value-42'
    const recording = buildRecording([inputEvent(1_000, 1, secret)])
    const proposed: Partial<Report> = { steps: [{ text: 'User types their password', atMs: 1_010, verified: false }] }

    const result = buildReport(recording, proposed)

    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.steps[0]).toMatchObject({ verified: true })
  })

  it('never echoes a typed input value when synthesizing steps directly from the digest, only its length', () => {
    const secret = 'super-secret-value-42'
    const recording = buildRecording([inputEvent(1_000, 1, secret)])

    const result = buildReport(recording, {})

    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).toContain(String(secret.length))
  })

  it('fills every string field the type promises, even when proposed is empty', () => {
    const recording = buildRecording([clickEvent(0, 1)])

    const result = buildReport(recording, {})

    expect(result.title).toBe('')
    expect(result.summary).toBe('')
    expect(result.expected).toBe('')
    expect(result.actual).toBe('')
    expect(result.rootCause).toBe('')
    expect(result.evidence).toEqual([])
    expect(JSON.stringify(result)).not.toContain('undefined')
  })

  it('passes through expected/actual/rootCause/evidence/summary/title from proposed when present', () => {
    const recording = buildRecording([clickEvent(0, 1)])
    const proposed: Partial<Report> = {
      title: 'Province field loses its value',
      summary: 'A one-line summary.',
      expected: 'The province should stay selected.',
      actual: 'The province reverts to empty after submit.',
      rootCause: 'The form resets state on a failed validation response.',
      evidence: [{ atMs: 120, note: 'Failed request logged here.' }],
    }

    const result = buildReport(recording, proposed)

    expect(result.title).toBe(proposed.title)
    expect(result.summary).toBe(proposed.summary)
    expect(result.expected).toBe(proposed.expected)
    expect(result.actual).toBe(proposed.actual)
    expect(result.rootCause).toBe(proposed.rootCause)
    expect(result.evidence).toEqual(proposed.evidence)
  })

  it('forces author to agent regardless of what proposed claims', () => {
    const recording = buildRecording([clickEvent(0, 1)])

    expect(buildReport(recording, {}).author).toBe('agent')
    expect(buildReport(recording, { author: 'human' }).author).toBe('agent')
  })

  it('synthesizes verified steps directly from the digest when proposed.steps is absent', () => {
    const recording = buildRecording([clickEvent(0, 1), metaEvent(10, 'https://example.test/')])

    const result = buildReport(recording, {})

    expect(result.steps).toHaveLength(2)
    expect(result.steps.every((step) => step.verified)).toBe(true)
    expect(result.steps.map((step) => step.atMs)).toEqual([0, 10])
  })

  it('synthesizes from the digest when proposed.steps is an empty array too', () => {
    const recording = buildRecording([clickEvent(0, 1)])

    const result = buildReport(recording, { steps: [] })

    expect(result.steps).toEqual([{ text: 'Clicked node 1.', atMs: 0, verified: true }])
  })

  it('excludes console errors and failed requests from synthesized steps, since those are symptoms, not actions', () => {
    const recording = buildRecording([clickEvent(0, 1), consoleErrorEvent(10, 'boom')])

    const result = buildReport(recording, {})

    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({ verified: true })
  })

  /**
   * `buildEventDigest` truncates to the earliest `DIGEST_LIMIT` (40) events unless told otherwise, which
   * is right for `list_events` — one page of a browsable list — and wrong for a report, which is built
   * from the whole session. The two tests below are the reason `buildReport` passes an explicit limit.
   *
   * A recording long enough to matter is the point: 51 clicks, so the last one falls past the cap. It
   * also sits more than `MATCH_WINDOW_MS` from every event that survives truncation, so a step citing it
   * cannot be verified by accidentally matching a nearer neighbour.
   */
  function longRecording(): Recording {
    const early = Array.from({ length: 50 }, (_, index) => clickEvent(100 + index * 100, index + 1))
    return buildRecording([...early, clickEvent(9_000, 99)], 10_000)
  }

  it('verifies a proposed step against a late event, not only the ones inside the digest default', () => {
    const proposed: Partial<Report> = { steps: [{ text: 'User clicks pay', atMs: 9_000, verified: true }] }

    const result = buildReport(longRecording(), proposed)

    expect(result.steps).toEqual([{ text: 'User clicks pay', atMs: 9_000, verified: true }])
  })

  it('synthesizes steps from the whole recording, not just its first forty events', () => {
    const result = buildReport(longRecording(), {})

    expect(result.steps).toHaveLength(51)
    expect(result.steps.at(-1)).toEqual({ text: 'Clicked node 99.', atMs: 9_000, verified: true })
  })
})
