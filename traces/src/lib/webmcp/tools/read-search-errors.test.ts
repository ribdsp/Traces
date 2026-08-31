import { beforeEach, describe, expect, it } from 'vitest'
import type { Author, Recording, RrwebEvent, Severity } from '@/types/domain'
import { useSessionStore } from '@/lib/store/session'
import { bisectTool } from './bisect'
import { diffDomToolDefinition } from './diff-dom'
import { findElementTool } from './find-element'
import { listEventsTool } from './list-events'
import { measureLayoutToolDefinition } from './measure-layout'
import { readConsoleTool } from './read-console'
import { readDomAtTool } from './read-dom-at'
import { readMarkersTool } from './read-markers'
import { readNetworkTool } from './read-network'
import { readSessionMetaTool } from './read-session-meta'
import type { ToolDefinition, ToolResponse } from '../tool-types'

/**
 * Rejection paths for the ten read/search wrappers.
 *
 * These test the wrappers' own logic and nothing else: argument validation, the "not ready" and "no
 * recording" replies, and the two places where a wrapper reads data the digest does not expose. The
 * behaviour of `compressDom`, `diffDom`, `bisect` and `measureLayout` is tested next to each of them.
 *
 * The rule being enforced throughout is the one from CONTRIBUTING.md § Testing a tool: **a failure comes
 * back as a readable tool error, never as a thrown exception.** A tool that throws reaches the model as
 * a host-level failure it can only report; a tool that returns a sentence naming what was wrong gets
 * corrected on the next call. Every assertion below is therefore on `isError` *and* on the text, because
 * an unhelpful error passes the first check.
 */

const READ_AND_SEARCH_TOOLS: ToolDefinition[] = [
  readSessionMetaTool,
  listEventsTool,
  findElementTool,
  readDomAtTool,
  readConsoleTool,
  readNetworkTool,
  readMarkersTool,
  bisectTool,
  diffDomToolDefinition,
  measureLayoutToolDefinition,
]

/** Arguments that are valid for each tool, so a rejection can only come from missing page state. */
const VALID_ARGS: Record<string, Record<string, unknown>> = {
  read_session_meta: {},
  list_events: {},
  find_element: { selector: 'button' },
  read_dom_at: { timestamp: 0 },
  read_console: {},
  read_network: {},
  read_markers: {},
  bisect: { selector: 'button', predicate: { kind: 'exists', equals: true }, from: 0, to: 1000 },
  diff_dom: { from: 0, to: 1000 },
  measure_layout: { selectors: ['button'], timestamp: 0 },
}

function textOf(response: ToolResponse): string {
  return response.content.map((part) => part.text).join('\n')
}

function customEvent(atMs: number, payload: Record<string, unknown>): RrwebEvent {
  return { type: 5, timestamp: 1_000 + atMs, data: { tag: 'network-request', payload } }
}

function consoleEvent(atMs: number, level: string, message: string): RrwebEvent {
  return { type: 3, timestamp: 1_000 + atMs, data: { source: 11, level, payload: [message] } }
}

function recordingWith(events: RrwebEvent[]): Recording {
  return {
    id: 'fixture',
    label: 'fixture',
    events,
    startedAt: 1_000,
    durationMs: 10_000,
    meta: {
      recordingId: 'fixture',
      durationMs: 10_000,
      eventCount: events.length,
      viewport: { width: 1280, height: 800 },
      userAgent: 'fixture',
      navigations: [{ atMs: 0, url: 'https://example.test/checkout' }],
      counts: { clicks: 0, inputs: 0, consoleErrors: 0, failedRequests: 0 },
    },
  }
}

function load(events: RrwebEvent[]): void {
  useSessionStore.getState().loadRecording(recordingWith(events), [])
}

/**
 * A marker straight into the store, rather than through `annotate`. What is under test is what
 * `read_markers` gives back, and `annotate` has a budget of its own that would cap the fixture before
 * the read budget could bite.
 */
function mark(atMs: number, label: string, author: Author, severity: Severity = 'info'): string {
  return useSessionStore.getState().addMarker({ timestamp: atMs, label, severity, author })
}

async function call(tool: ToolDefinition, args: Record<string, unknown> = {}): Promise<ToolResponse> {
  return tool.execute(args)
}

describe('read and search tools with no recording loaded', () => {
  beforeEach(() => {
    useSessionStore.getState().reset()
  })

  it('stay registered and explain themselves instead of disappearing', async () => {
    for (const tool of READ_AND_SEARCH_TOOLS) {
      const response = await call(tool, VALID_ARGS[tool.name] ?? {})
      expect(response.isError, tool.name).toBe(true)
      expect(textOf(response), tool.name).toContain('No recording is loaded')
    }
  })
})

describe('read and search tools before the player has mounted', () => {
  beforeEach(() => {
    load([])
  })

  it('tell the DOM-reading tools to retry rather than handing back a stack trace', async () => {
    const needEngine = [findElementTool, readDomAtTool, bisectTool, diffDomToolDefinition, measureLayoutToolDefinition]
    for (const tool of needEngine) {
      const response = await call(tool, VALID_ARGS[tool.name] ?? {})
      expect(response.isError, tool.name).toBe(true)
      expect(textOf(response), tool.name).toMatch(/has not finished mounting/)
      expect(textOf(response), tool.name).toMatch(/call this tool again/)
    }
  })

  it('still answer for the tools that only read the recording file', async () => {
    for (const tool of [readSessionMetaTool, listEventsTool, readConsoleTool, readNetworkTool, readMarkersTool]) {
      const response = await call(tool, {})
      expect(response.isError, tool.name).toBeUndefined()
    }
  })
})

describe('argument validation', () => {
  beforeEach(() => {
    load([])
  })

  it('names the accepted event kinds when list_events is given one it does not know', async () => {
    const response = await call(listEventsTool, { kinds: ['error'] })
    expect(response.isError).toBe(true)
    expect(textOf(response)).toContain('"error"')
    expect(textOf(response)).toContain('consoleError')
  })

  it('rejects an inverted time window instead of quietly swapping the ends', async () => {
    const response = await call(listEventsTool, { from: 5_000, to: 1_000 })
    expect(response.isError).toBe(true)
    expect(textOf(response)).toMatch(/is after/)
  })

  it('returns the predicate validator\'s own sentence for an unsupported predicate kind', async () => {
    const response = await call(bisectTool, {
      selector: 'button',
      predicate: { kind: 'jsExpression', expression: 'el.disabled' },
      from: 0,
      to: 1_000,
    })
    expect(response.isError).toBe(true)
    expect(textOf(response)).toContain("Unsupported predicate kind 'jsExpression'")
    expect(textOf(response)).toContain('propertyEquals')
  })

  it('rejects a timestamp outside the recording, naming the recording length', async () => {
    const response = await call(readDomAtTool, { timestamp: 90_000 })
    expect(response.isError).toBe(true)
    expect(textOf(response)).toContain('10000 ms')
  })

  it('rejects a missing timestamp as a missing argument, not as an invalid one', async () => {
    const response = await call(readDomAtTool, {})
    expect(response.isError).toBe(true)
    expect(textOf(response)).toContain("'timestamp' is required")
  })

  it('asks find_element for at least one criterion', async () => {
    const response = await call(findElementTool, {})
    expect(response.isError).toBe(true)
    expect(textOf(response)).toMatch(/at least one of "selector", "text" or "role"/)
  })

  it('refuses to diff one instant against itself', async () => {
    const response = await call(diffDomToolDefinition, { from: 2_000, to: 2_000 })
    expect(response.isError).toBe(true)
    expect(textOf(response)).toMatch(/nothing to compare/)
  })

  it('requires a non-empty selectors array for measure_layout', async () => {
    const response = await call(measureLayoutToolDefinition, { selectors: [], timestamp: 0 })
    expect(response.isError).toBe(true)
    expect(textOf(response)).toContain("'selectors' must be a non-empty array")
  })
})

describe('read_network', () => {
  beforeEach(() => {
    load([
      customEvent(1_000, {
        url: 'https://example.test/api/provinces',
        method: 'get',
        status: 200,
        ok: true,
        durationMs: 41.7,
        bodySummary: 'array, 0 items',
      }),
      customEvent(2_000, { url: 'https://example.test/api/pay', method: 'POST', status: 500, ok: false }),
    ])
  })

  it('reports successful requests, not only failures', async () => {
    const response = await call(readNetworkTool, {})
    const payload = JSON.parse(textOf(response)) as {
      requests: { url: string; method: string; status?: number; durationMs?: number; bodySummary?: string }[]
      totalMatched: number
      failedCount: number
    }

    expect(payload.totalMatched).toBe(2)
    expect(payload.failedCount).toBe(1)
    expect(payload.requests.map((request) => request.status)).toEqual([200, 500])
    // The 200 is the interesting one: an empty list from a successful call is the bug in bugbait's
    // checkout, and a failures-only tool would report that nothing was requested at all.
    expect(payload.requests[0]?.bodySummary).toBe('array, 0 items')
    expect(payload.requests[0]?.method).toBe('GET')
    expect(payload.requests[0]?.durationMs).toBe(42)
  })

  it('filters on a URL substring, case-insensitively', async () => {
    const response = await call(readNetworkTool, { filter: 'PROVINCES' })
    const payload = JSON.parse(textOf(response)) as { requests: { url: string }[] }
    expect(payload.requests).toHaveLength(1)
    expect(payload.requests[0]?.url).toContain('provinces')
  })

  it('says so rather than implying silence when nothing was instrumented', async () => {
    load([])
    const response = await call(readNetworkTool, {})
    expect(JSON.parse(textOf(response)).note).toMatch(/No network requests were recorded/)
  })
})

describe('read_markers', () => {
  type MarkersPayload = {
    fromMs: number
    toMs: number
    markers: { id: string; atMs: number; label: string; severity: string; author: string; rejected?: boolean }[]
    totalMatched: number
    humanCount: number
    agentCount: number
    truncated: boolean
    note?: string
  }

  const readMarkers = async (args: Record<string, unknown> = {}): Promise<MarkersPayload> =>
    JSON.parse(textOf(await call(readMarkersTool, args))) as MarkersPayload

  beforeEach(() => {
    load([])
  })

  it('says nothing has been pinned rather than answering with an empty list alone', async () => {
    const payload = await readMarkers()

    expect(payload.markers).toEqual([])
    expect(payload.totalMatched).toBe(0)
    expect(payload.note).toMatch(/No markers in this window/)
  })

  it('returns both authors in timeline order, whatever order they were made in', async () => {
    mark(6_000, 'agent looked here last', 'agent', 'warn')
    mark(2_000, 'human looked here first', 'human')

    const payload = await readMarkers()

    expect(payload.markers.map((marker) => marker.atMs)).toEqual([2_000, 6_000])
    expect(payload.markers.map((marker) => marker.author)).toEqual(['human', 'agent'])
    expect(payload.markers[0]?.label).toBe('human looked here first')
    expect(payload.markers[1]?.severity).toBe('warn')
    expect(payload.humanCount).toBe(1)
    expect(payload.agentCount).toBe(1)
    expect(payload.truncated).toBe(false)
  })

  it('flags a rejected marker instead of hiding it, so it is not proposed again', async () => {
    const id = mark(3_000, 'the human disagreed with this', 'agent', 'error')
    useSessionStore.getState().rejectMarker(id)

    const payload = await readMarkers()

    expect(payload.markers).toHaveLength(1)
    expect(payload.markers[0]?.rejected).toBe(true)
  })

  it('omits the rejected field entirely when the marker stands', async () => {
    mark(3_000, 'still standing', 'human')

    const payload = await readMarkers()

    // Absent rather than `false`: `rejected: false` on every marker is noise a model has to read past.
    expect(payload.markers[0]).not.toHaveProperty('rejected')
  })

  it('leaves out markers outside the requested window', async () => {
    mark(500, 'before the window', 'human')
    mark(4_000, 'inside the window', 'agent')
    mark(9_500, 'after the window', 'human')

    const payload = await readMarkers({ from: 1_000, to: 5_000 })

    expect(payload.fromMs).toBe(1_000)
    expect(payload.toMs).toBe(5_000)
    expect(payload.markers.map((marker) => marker.label)).toEqual(['inside the window'])
    // The count is of the window, not of the session: two markers exist that this call did not match.
    expect(payload.totalMatched).toBe(1)
  })

  it("keeps the human's markers when the cap bites, and stays chronological", async () => {
    for (let index = 0; index < 45; index += 1) mark(index * 100, `agent note ${index}`, 'agent')
    mark(9_000, 'the human pinned this', 'human')

    const payload = await readMarkers()

    expect(payload.markers).toHaveLength(40)
    expect(payload.totalMatched).toBe(46)
    expect(payload.truncated).toBe(true)
    expect(payload.note).toMatch(/the human's kept first/)
    // It is the latest marker of the 46, so a plain chronological cap would have dropped it.
    expect(payload.markers.some((marker) => marker.author === 'human')).toBe(true)
    expect(payload.markers.map((marker) => marker.atMs)).toEqual(
      [...payload.markers].sort((left, right) => left.atMs - right.atMs).map((marker) => marker.atMs),
    )
  })
})

describe('list_events and read_console budgets', () => {
  it('reports the true match count alongside the capped list', async () => {
    const events: RrwebEvent[] = []
    for (let index = 0; index < 60; index += 1) {
      events.push(consoleEvent(index * 100, 'error', `boom ${index}`))
    }
    load(events)

    const listed = JSON.parse(textOf(await call(listEventsTool, {}))) as {
      events: unknown[]
      totalMatched: number
      truncated: boolean
      note?: string
    }
    expect(listed.events).toHaveLength(40)
    // The point of counting separately: 40 is the cap, 60 is the answer.
    expect(listed.totalMatched).toBe(60)
    expect(listed.truncated).toBe(true)
    expect(listed.note).toMatch(/narrow the window|from:/)

    const console = JSON.parse(textOf(await call(readConsoleTool, {}))) as {
      entries: { atMs: number; level: string }[]
      totalMatched: number
      errorCount: number
      truncated: boolean
    }
    expect(console.entries).toHaveLength(40)
    expect(console.totalMatched).toBe(60)
    expect(console.errorCount).toBe(60)
    // Chronological, even after ranking decided what survived the cap.
    expect(console.entries.map((entry) => entry.atMs)).toEqual(
      [...console.entries].sort((left, right) => left.atMs - right.atMs).map((entry) => entry.atMs),
    )
  })

  it('keeps errors ahead of warnings when the cap bites', async () => {
    const events: RrwebEvent[] = []
    for (let index = 0; index < 45; index += 1) events.push(consoleEvent(index * 10, 'warn', `warn ${index}`))
    events.push(consoleEvent(9_000, 'error', 'the actual error'))
    load(events)

    const payload = JSON.parse(textOf(await call(readConsoleTool, {}))) as {
      entries: { level: string; message: string }[]
    }
    expect(payload.entries.some((entry) => entry.level === 'error')).toBe(true)
  })
})
